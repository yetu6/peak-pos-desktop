import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "../components/Icon";
import { TillControls } from "../components/TillControls";
import { ItemModifierDialog, type ModifierSelection } from "../components/ItemModifierDialog";
import {
  CategoryTab,
  MoneyDisplay,
  OrderLine,
  OrderRail,
  ProductTile,
  QuantityStepper,
  TerminalState,
} from "../components/terminal/TerminalPrimitives";
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
    <div className="new-order-screen">
      <div className="new-order-header">
        <div>
          <h1 className="text-lg font-bold tracking-[-0.02em] text-[var(--foreground)]">New order</h1>
          <p className="text-xs text-[var(--foreground-muted)]">Build the check, then create the order.</p>
        </div>
        <TillControls currency={currency} />
      </div>

      {!shift ? (
        <div className="p-5">
          <TerminalState state="empty" title="No open shift" description="Open a shift to start taking orders." />
        </div>
      ) : (
        <div className="new-order-layout">
          <section className="catalog-workspace" aria-label="Catalog">
            <div className="catalog-toolbar">
              {SERVICE_TYPES.map((type) => (
                <CategoryTab
                  key={type.id}
                  data-testid={`service-type-${type.id}`}
                  onClick={() => setServiceType(type.id)}
                  active={serviceType === type.id}
                >
                  {type.label}
                </CategoryTab>
              ))}
              <input
                data-testid="table-label"
                value={tableLabel}
                onChange={(e) => setTableLabel(e.target.value)}
                placeholder="Table"
                className="input ml-auto w-36"
              />
            </div>

            {categories.length > 0 && (
              <div className="category-tabs" aria-label="Menu categories">
                <CategoryTab
                  data-testid="category-all"
                  onClick={() => setActiveCategory("all")}
                  active={activeCategory === "all"}
                >
                  All
                </CategoryTab>
                {categories.map((category) => (
                  <CategoryTab
                    key={category.id}
                    data-testid={`category-${category.id}`}
                    onClick={() => setActiveCategory(category.id)}
                    active={activeCategory === category.id}
                  >
                    {category.name}
                  </CategoryTab>
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
              <TerminalState state="empty" title="No menu items available" description="This outlet has no available products in the current catalog." />
            )}

            <div className="product-grid">
              {visibleProducts.map((product) => (
                <ProductTile
                  key={product.id}
                  data-testid={`menu-${product.name}`}
                  onClick={() => tapProduct(product)}
                  name={product.name}
                  price={formatMinor(product.priceMinor, product.currency)}
                />
              ))}
            </div>
          </section>

          <OrderRail
            title="Current order"
            data-testid="current-order-rail"
            headerMeta={<p className="mt-1 text-xs text-[var(--foreground-muted)]">{totalLines} {totalLines === 1 ? "item" : "items"}</p>}
            footer={
              <>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <span className="text-xs text-[var(--foreground-muted)]">Estimated total</span>
                  <MoneyDisplay prominence="strong" className="text-base" data-testid="cart-preview-total">
                    {lines.length > 0 ? formatMinor(previewTotalMinor, currency) : "—"}
                  </MoneyDisplay>
                </div>
                <input
                  data-testid="order-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Order notes"
                  className="input w-full"
                />
                {created && <div className="badge badge-success mt-3" data-testid="order-created">{created} sent to Active orders</div>}
                {createError && <div className="badge badge-danger mt-3" data-testid="create-error">{createError}</div>}
                <button
                  data-testid="create-order"
                  onClick={() => void submit()}
                  disabled={lines.length === 0 || createOrder.isPending}
                  className="btn-primary mt-4 w-full"
                >
                  <Icon name="orders" size={17} />
                  {createOrder.isPending ? "Creating…" : "Create order"}
                </button>
              </>
            }
          >
            <ul>
              {lines.length === 0 && (
                <li className="py-8 text-center text-xs text-[var(--foreground-muted)]">Tap a menu item to start this order.</li>
              )}
              {lines.map((line) => (
                <OrderLine key={line.key} data-testid={`cart-${line.name}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-[var(--foreground)]">{line.name}</span>
                    {line.modifierLabel && <span className="block truncate text-[11px] text-[var(--foreground-muted)]">{line.modifierLabel}</span>}
                    <MoneyDisplay className="mt-1 block text-[11px] text-[var(--foreground-muted)]">
                      {formatMinor(line.previewUnitPriceMinor * line.quantity, currency)}
                    </MoneyDisplay>
                  </span>
                  <QuantityStepper
                    label={line.name}
                    value={line.quantity}
                    minimum={0}
                    onDecrease={() => changeQuantity(line.key, -1)}
                    onIncrease={() => changeQuantity(line.key, 1)}
                  />
                </OrderLine>
              ))}
            </ul>
          </OrderRail>
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
