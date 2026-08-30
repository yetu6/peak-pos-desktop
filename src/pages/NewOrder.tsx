import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "../components/Icon";
import { TillControls } from "../components/TillControls";
import { ItemModifierDialog, type ModifierSelection } from "../components/ItemModifierDialog";
import { formatMinor } from "../lib/posMoney";
import { createPosApi } from "../lib/posApi";
import { useCatalog, useCreateOrder, useIdempotencyKey, useMutationMessage, usePosShift } from "../hooks/usePosData";
import type { POSCatalogProduct, ServiceType } from "../lib/posContracts";

interface CartLine {
  key: string;
  productId: string;
  name: string;
  quantity: number;
  modifierOptionIds: string[];
  modifierLabel?: string;
  previewUnitPriceMinor: number;
}

const SERVICE_TYPES: Array<{ id: ServiceType; label: string }> = [
  { id: "DINE_IN", label: "Dine in" },
  { id: "TAKEAWAY", label: "Takeaway" },
  { id: "ROOM_SERVICE", label: "Room service" },
];

function cartKey(productId: string, modifierOptionIds: string[]): string {
  return `${productId}::${[...modifierOptionIds].sort().join(",")}`;
}

export function NewOrder() {
  const { shift } = usePosShift();
  const catalog = useCatalog();
  const createOrder = useCreateOrder();
  const idempotencyKey = useIdempotencyKey();
  const createError = useMutationMessage(createOrder.error);
  const queryClient = useQueryClient();

  const categories = catalog.data?.categories ?? [];
  const products = catalog.data?.products ?? [];
  const currency = products[0]?.currency ?? "TZS";

  const [activeCategory, setActiveCategory] = useState<string | "all">("all");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [serviceType, setServiceType] = useState<ServiceType>("DINE_IN");
  const [tableLabel, setTableLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<POSCatalogProduct | null>(null);

  const visibleProducts = useMemo(
    () => (activeCategory === "all" ? products : products.filter((p) => p.categoryId === activeCategory)),
    [products, activeCategory],
  );

  function addPlainProduct(product: POSCatalogProduct): void {
    setCreated(null);
    const key = cartKey(product.id, []);
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { key, productId: product.id, name: product.name, quantity: 1, modifierOptionIds: [], previewUnitPriceMinor: product.priceMinor }];
    });
  }

  function tapProduct(product: POSCatalogProduct): void {
    const hasRequiredOrOptionalModifiers = (product.modifierGroups ?? []).some((g) => g.isActive);
    if (hasRequiredOrOptionalModifiers) {
      setConfiguring(product);
      return;
    }
    addPlainProduct(product);
  }

  function confirmModifiers(product: POSCatalogProduct, selection: ModifierSelection): void {
    setCreated(null);
    const key = cartKey(product.id, selection.modifierOptionIds);
    const optionNames = (product.modifierGroups ?? [])
      .flatMap((g) => g.options ?? [])
      .filter((o) => selection.modifierOptionIds.includes(o.id))
      .map((o) => o.name);
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + selection.quantity } : l));
      return [
        ...prev,
        {
          key,
          productId: product.id,
          name: product.name,
          quantity: selection.quantity,
          modifierOptionIds: selection.modifierOptionIds,
          modifierLabel: optionNames.length > 0 ? optionNames.join(", ") : undefined,
          previewUnitPriceMinor: selection.previewUnitPriceMinor,
        },
      ];
    });
    setConfiguring(null);
  }

  function changeQuantity(key: string, delta: number): void {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0));
  }

  const totalLines = lines.reduce((sum, l) => sum + l.quantity, 0);
  const previewTotalMinor = lines.reduce((sum, l) => sum + l.previewUnitPriceMinor * l.quantity, 0);

  async function submit(): Promise<void> {
    if (!shift?.id || lines.length === 0) return;
    const key = idempotencyKey.next();
    createOrder.mutate(
      { shiftId: shift.id, serviceType, tableLabel: tableLabel.trim() || undefined, notes: notes.trim() || undefined, idempotencyKey: key },
      {
        onSuccess: async (order) => {
          const api = createPosApi();
          let version = order.version;
          let orderNumber = order.orderNumber;
          for (const line of lines) {
            const { data, error } = await api.addItem(
              order.id,
              { productId: line.productId, quantity: line.quantity, modifierOptionIds: line.modifierOptionIds, version },
              crypto.randomUUID(),
            );
            if (error || !data) break;
            version = data.version;
            orderNumber = data.orderNumber;
          }
          queryClient.invalidateQueries({ queryKey: ["pos", "orders"] });
          queryClient.invalidateQueries({ queryKey: ["pos", "order", order.id] });
          setLines([]);
          setTableLabel("");
          setNotes("");
          setCreated(orderNumber);
        },
      },
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">New order</h2>
        <TillControls currency={currency} />
      </div>

      {!shift ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon name="clock" size={40} />
            </div>
            <div className="empty-state-title">No open shift</div>
            <div className="empty-state-desc">Open a shift to start taking orders.</div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {SERVICE_TYPES.map((type) => (
                <button
                  key={type.id}
                  data-testid={`service-type-${type.id}`}
                  onClick={() => setServiceType(type.id)}
                  className={`pill-filter-btn ${serviceType === type.id ? "active" : ""}`}
                >
                  {type.label}
                </button>
              ))}
              <input
                data-testid="table-label"
                value={tableLabel}
                onChange={(e) => setTableLabel(e.target.value)}
                placeholder="Table"
                className="input ml-auto w-40"
              />
            </div>

            {categories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  data-testid="category-all"
                  onClick={() => setActiveCategory("all")}
                  className={`pill-filter-btn ${activeCategory === "all" ? "active" : ""}`}
                >
                  All
                </button>
                {categories.map((category) => (
                  <button
                    key={category.id}
                    data-testid={`category-${category.id}`}
                    onClick={() => setActiveCategory(category.id)}
                    className={`pill-filter-btn ${activeCategory === category.id ? "active" : ""}`}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            )}

            {catalog.isLoading && <div className="skeleton h-40 w-full rounded-xl" />}
            {catalog.isError && (
              <p className="text-[12px] text-[var(--color-danger)]" data-testid="catalog-error">
                Menu unavailable. Ask a manager.
              </p>
            )}
            {!catalog.isLoading && !catalog.isError && visibleProducts.length === 0 && (
              <div className="card">
                <div className="empty-state">
                  <div className="empty-state-title">No menu items are available for this outlet.</div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {visibleProducts.map((product) => (
                <button
                  key={product.id}
                  data-testid={`menu-${product.name}`}
                  onClick={() => tapProduct(product)}
                  className="card flex flex-col items-start gap-1 p-4 text-left transition-colors hover:border-[var(--color-gold)]"
                >
                  <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{product.name}</span>
                  <span className="text-[11px] text-[var(--color-text-muted)]">{formatMinor(product.priceMinor, product.currency)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="glass-panel h-fit p-4">
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">
              Order · {totalLines} {totalLines === 1 ? "item" : "items"}
            </div>
            <ul className="mt-3 space-y-2">
              {lines.length === 0 && <li className="text-[12px] text-[var(--color-text-muted)]">Tap menu items to add them.</li>}
              {lines.map((line) => (
                <li key={line.key} className="flex items-center justify-between gap-2 text-[13px]" data-testid={`cart-${line.name}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--color-text)]">{line.name}</span>
                    {line.modifierLabel && <span className="block truncate text-[11px] text-[var(--color-text-muted)]">{line.modifierLabel}</span>}
                  </span>
                  <span className="flex items-center gap-1">
                    <button onClick={() => changeQuantity(line.key, -1)} className="qty-btn" aria-label={`Decrease ${line.name}`}>
                      −
                    </button>
                    <span className="w-6 text-center font-mono text-sm tabular-nums">{line.quantity}</span>
                    <button onClick={() => changeQuantity(line.key, 1)} className="qty-btn" aria-label={`Increase ${line.name}`}>
                      +
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            {lines.length > 0 && (
              <div className="mt-3 flex justify-between border-t border-[var(--color-border-subtle)] pt-2 text-[12px] text-[var(--color-text-muted)]">
                <span>Estimated total</span>
                <span data-testid="cart-preview-total">{formatMinor(previewTotalMinor, currency)}</span>
              </div>
            )}
            <input
              data-testid="order-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes"
              className="input mt-3 w-full"
            />
            {created && (
              <div className="badge badge-success mt-3" data-testid="order-created">
                {created} sent to Active orders
              </div>
            )}
            {createError && (
              <div className="badge badge-danger mt-3" data-testid="create-error">
                {createError}
              </div>
            )}
            <button
              data-testid="create-order"
              onClick={() => void submit()}
              disabled={lines.length === 0 || createOrder.isPending}
              className="btn-primary btn-md mt-4 w-full"
            >
              <Icon name="orders" size={16} />
              {createOrder.isPending ? "Creating…" : "Create order"}
            </button>
          </div>
        </div>
      )}

      {configuring && (
        <ItemModifierDialog
          product={configuring}
          currency={configuring.currency}
          onCancel={() => setConfiguring(null)}
          onConfirm={(selection) => confirmModifiers(configuring, selection)}
        />
      )}
    </div>
  );
}
