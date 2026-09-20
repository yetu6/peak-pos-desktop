import { useMemo, useState } from "react";
import {
  LocalCashSaved,
  LocalCashSettlementDialog,
} from "../components/LocalCashSettlementDialog";
import {
  CategoryTab,
  MoneyDisplay,
  OrderLine,
  OrderRail,
  ProductTile,
  QuantityStepper,
  TerminalState,
} from "../components/terminal/TerminalPrimitives";
import { useLocalCatalog, useLocalDraft } from "../hooks/useLocalOrder";
import type { OfflineCashCommitResult } from "../lib/localPosCore";
import { formatMinor } from "../lib/posMoney";

const SERVICE_TYPES = [
  { id: "DINE_IN", label: "Dine in" },
  { id: "TAKEAWAY", label: "Takeaway" },
] as const;

type ServiceType = (typeof SERVICE_TYPES)[number]["id"];

/**
 * Cash-only register against the local Rust store. Used when PIN unlock
 * entered `offline-cash` mode (Peak unreachable, certified offline lease).
 * No kitchen send, no room charge, no mobile money — Sync Center drains the
 * outbox when connectivity returns.
 */
export function OfflineNewOrder() {
  const [serviceType, setServiceType] = useState<ServiceType>("DINE_IN");
  const [tableLabel, setTableLabel] = useState("");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | undefined>();
  const [settleOpen, setSettleOpen] = useState(false);
  const [saved, setSaved] = useState<OfflineCashCommitResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const catalog = useLocalCatalog(search, activeCategory);
  const {
    draft,
    addItem,
    setQuantity,
    removeLine,
    updateContext,
    commit,
    settleCash,
  } = useLocalDraft(serviceType);

  const order = draft.data;
  const currency = catalog.data?.currency ?? order?.currency ?? "TZS";
  const products = catalog.data?.products ?? [];
  const categories = catalog.data?.categories ?? [];
  const busy =
    addItem.isPending ||
    setQuantity.isPending ||
    removeLine.isPending ||
    commit.isPending ||
    settleCash.isPending ||
    updateContext.isPending;

  const totalItems = useMemo(
    () => (order?.lines ?? []).reduce((sum, line) => sum + line.quantity, 0),
    [order?.lines],
  );

  async function tapProduct(productId: string) {
    setActionError(null);
    setSaved(null);
    try {
      if (tableLabel.trim() && order && order.tableLabel !== tableLabel.trim()) {
        await updateContext.mutateAsync({
          serviceType,
          tableLabel: tableLabel.trim() || undefined,
        });
      }
      await addItem.mutateAsync({ productId, quantity: 1, modifierOptionIds: [] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not add item.");
    }
  }

  async function onSettle(cashReceivedMinor: number) {
    setActionError(null);
    try {
      if (order?.state === "DRAFT") {
        await commit.mutateAsync();
      }
      const result = await settleCash.mutateAsync(cashReceivedMinor);
      setSaved(result);
      setSettleOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Cash was not committed.");
    }
  }

  return (
    <div className="new-order-screen" data-testid="offline-new-order">
      <div className="new-order-header">
        <div>
          <h1 className="text-lg font-bold tracking-[-0.02em] text-[var(--foreground)]">
            Offline register
          </h1>
          <p className="text-xs text-[var(--foreground-muted)]">
            Cash only · sales queue on this terminal until Peak is reachable
          </p>
        </div>
        <span className="badge badge-warning badge-dot" data-testid="offline-cash-badge">
          Offline cash
        </span>
      </div>

      <div className="new-order-layout">
        <section className="catalog-workspace" aria-label="Local catalog">
          <div className="catalog-toolbar">
            {SERVICE_TYPES.map((type) => (
              <CategoryTab
                key={type.id}
                data-testid={`service-type-${type.id}`}
                active={serviceType === type.id}
                disabled={busy || Boolean(order?.lines.length)}
                onClick={() => {
                  setServiceType(type.id);
                  void updateContext.mutateAsync({ serviceType: type.id, tableLabel: tableLabel.trim() || undefined });
                }}
              >
                {type.label}
              </CategoryTab>
            ))}
            <label className="relative ml-auto min-w-44">
              <span className="sr-only">Search menu</span>
              <input
                data-testid="catalog-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search menu"
                className="input w-full"
              />
            </label>
            <input
              data-testid="table-label"
              value={tableLabel}
              onChange={(event) => setTableLabel(event.target.value)}
              placeholder="Table"
              className="input w-28"
            />
          </div>

          {categories.length > 0 && (
            <div className="category-tabs" aria-label="Menu categories">
              <CategoryTab
                data-testid="category-all"
                active={!activeCategory}
                onClick={() => setActiveCategory(undefined)}
              >
                All
              </CategoryTab>
              {categories.map((category) => (
                <CategoryTab
                  key={category.id}
                  data-testid={`category-${category.id}`}
                  active={activeCategory === category.id}
                  onClick={() => setActiveCategory(category.id)}
                >
                  {category.name}
                </CategoryTab>
              ))}
            </div>
          )}

          {catalog.isLoading && <div className="skeleton h-40 w-full rounded-xl" />}
          {catalog.isError && (
            <TerminalState
              state="offline"
              title="Local catalog unavailable"
              description="Offline selling needs a certified catalog snapshot. Go online once, then try again."
            />
          )}
          {!catalog.isLoading && !catalog.isError && products.length === 0 && (
            <TerminalState
              state="empty"
              title="No matching items"
              description="Try another category or search term."
            />
          )}
          <div className="product-grid">
            {products.map((product) => (
              <ProductTile
                key={product.id}
                data-testid={`menu-${product.name}`}
                disabled={busy || !order}
                onClick={() => void tapProduct(product.id)}
                name={product.name}
                price={formatMinor(product.priceMinor, product.currency)}
              />
            ))}
          </div>
        </section>

        <OrderRail
          title="Ticket"
          data-testid="offline-order-rail"
          className="receipt-ticket"
          headerMeta={
            <p className="mt-1 text-xs text-[var(--foreground-muted)]">
              {totalItems} {totalItems === 1 ? "item" : "items"}
              {order ? ` · ${order.state.toLowerCase()}` : " · new"}
              {" · offline"}
            </p>
          }
          footer={
            <>
              {actionError && (
                <div className="badge badge-danger mb-2" role="alert">
                  {actionError}
                </div>
              )}
              {saved && (
                <>
                  <LocalCashSaved result={saved} currency={currency} />
                  <button
                    type="button"
                    className="btn-secondary btn-sm mt-2"
                    data-testid="offline-new-sale"
                    onClick={() => {
                      setSaved(null);
                      void draft.refetch();
                    }}
                  >
                    New sale
                  </button>
                </>
              )}
              <div className="flex items-center justify-between gap-3">
                <MoneyDisplay prominence="strong">
                  {formatMinor(order?.totalMinor ?? 0, currency)}
                </MoneyDisplay>
                <button
                  type="button"
                  data-testid="offline-pay"
                  className="btn-primary"
                  disabled={!order || (order.lines?.length ?? 0) === 0 || busy || Boolean(saved)}
                  onClick={() => setSettleOpen(true)}
                >
                  Pay cash
                </button>
              </div>
            </>
          }
        >
          {(order?.lines ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--foreground-muted)]">
              Tap a menu item to start an offline cash sale.
            </p>
          ) : (
            <ul className="space-y-2 px-3 py-2">
              {(order?.lines ?? []).map((line) => (
                <OrderLine key={line.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{line.name}</div>
                      <div className="text-[11px] text-[var(--foreground-muted)]">
                        {formatMinor(line.unitPriceMinor, currency)}
                      </div>
                    </div>
                    <MoneyDisplay>{formatMinor(line.lineTotalMinor, currency)}</MoneyDisplay>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <QuantityStepper
                      label={line.name}
                      value={line.quantity}
                      onDecrease={() =>
                        void setQuantity.mutateAsync({
                          lineId: line.id,
                          quantity: Math.max(1, line.quantity - 1),
                        })
                      }
                      onIncrease={() =>
                        void setQuantity.mutateAsync({
                          lineId: line.id,
                          quantity: line.quantity + 1,
                        })
                      }
                    />
                    <button
                      type="button"
                      className="btn-tertiary btn-sm"
                      disabled={busy}
                      onClick={() => void removeLine.mutateAsync(line.id)}
                    >
                      Remove
                    </button>
                  </div>
                </OrderLine>
              ))}
            </ul>
          )}
        </OrderRail>
      </div>

      {settleOpen && order && (
        <LocalCashSettlementDialog
          amountDueMinor={order.totalMinor}
          currency={currency}
          busy={settleCash.isPending || commit.isPending}
          error={Boolean(actionError) && settleCash.isError}
          onCancel={() => setSettleOpen(false)}
          onConfirm={(cash) => void onSettle(cash)}
        />
      )}
    </div>
  );
}
