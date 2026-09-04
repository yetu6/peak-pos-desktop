import { Icon } from "../components/Icon";
import {
  CategoryTab,
  MoneyDisplay,
  OperationalStatus,
  OrderLine,
  OrderRail,
  ProductTile,
  QuantityStepper,
} from "../components/terminal/TerminalPrimitives";

const PRODUCTS = [
  ["Cappuccino", "TZS 6,500"],
  ["Flat white", "TZS 7,000"],
  ["Passion cooler", "TZS 5,500"],
  ["Peak breakfast", "TZS 18,000"],
  ["Avocado toast", "TZS 14,500"],
  ["House burger", "TZS 22,000"],
  ["Grilled chicken", "TZS 25,000"],
  ["Coconut curry", "TZS 21,500"],
  ["Seasonal salad", "TZS 16,000"],
  ["Chocolate tart", "TZS 9,500"],
  ["Sparkling water", "TZS 4,000"],
  ["Fresh juice", "TZS 6,000"],
] as const;

const NAV = [
  ["orders", "Active orders"],
  ["plus", "New order"],
  ["kitchen", "Kitchen"],
  ["manager", "Manager"],
] as const;

/** Development-only composition used to capture deterministic real-Tauri viewport evidence. */
export function PeakTerminalFixture() {
  return (
    <div className="terminal-shell">
      <aside className="terminal-nav" aria-label="Terminal navigation">
        <div className="terminal-brand">
          <Icon name="peak-logo" size={24} className="text-[var(--gold-accent)]" />
          <span className="terminal-brand__name">Peak Terminal</span>
        </div>
        <nav className="terminal-nav__items">
          {NAV.map(([icon, label], index) => (
            <button key={label} className="terminal-nav__action" aria-current={index === 1 ? "page" : undefined} aria-label={label}>
              <Icon name={icon} size={20} />
              <span className="terminal-nav__label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="terminal-staff">
          <span className="terminal-staff__avatar">AN</span>
          <div className="terminal-staff__meta">
            <div className="truncate text-xs font-semibold">Amina N.</div>
            <div className="truncate text-[11px] text-[var(--foreground-muted)]">Main restaurant</div>
          </div>
          <button className="btn-tertiary ml-auto !size-11 !p-0" aria-label="Switch staff">
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>

      <div className="terminal-frame">
        <header className="terminal-header px-4">
          <span className="font-mono text-[13px] font-semibold tabular-nums text-[var(--foreground-muted)]">14:32</span>
          <span className="h-5 w-px bg-[var(--border)]" />
          <OperationalStatus tone="success">Shift open · 02 Sep</OperationalStatus>
          <div className="flex-1" />
          <OperationalStatus tone="success" announce>Live</OperationalStatus>
        </header>

        <main className="terminal-workspace terminal-workspace--order">
          <div className="new-order-screen">
            <div className="new-order-header">
              <div>
                <h1 className="text-lg font-bold tracking-[-0.02em]">New order</h1>
                <p className="text-xs text-[var(--foreground-muted)]">Table 12 · Dine in</p>
              </div>
              <button className="btn-secondary"><Icon name="payments" size={17} />Cash drawer</button>
            </div>

            <div className="new-order-layout">
              <section className="catalog-workspace" aria-label="Catalog workspace">
                <div className="catalog-toolbar">
                  <CategoryTab active>Dine in</CategoryTab>
                  <CategoryTab active={false}>Takeaway</CategoryTab>
                  <CategoryTab active={false}>Room service</CategoryTab>
                  <input className="input ml-auto min-w-40" aria-label="Search catalog" placeholder="Search menu" />
                </div>
                <div className="category-tabs" aria-label="Menu categories">
                  {['Popular', 'Breakfast', 'Mains', 'Drinks', 'Dessert'].map((category, index) => (
                    <CategoryTab key={category} active={index === 0}>{category}</CategoryTab>
                  ))}
                </div>
                <div className="product-grid">
                  {PRODUCTS.map(([name, price]) => (
                    <ProductTile key={name} name={name} price={price} aria-label={`Add ${name}`} />
                  ))}
                </div>
              </section>

              <OrderRail
                title="Current order"
                headerMeta={<p className="mt-1 text-xs text-[var(--foreground-muted)]">3 items · Table 12</p>}
                footer={
                  <>
                    <div className="mb-3 flex items-end justify-between gap-3">
                      <span className="text-xs text-[var(--foreground-muted)]">Total</span>
                      <MoneyDisplay prominence="strong" className="text-lg">TZS 42,500</MoneyDisplay>
                    </div>
                    <button className="btn-primary w-full"><Icon name="orders" size={17} />Create order</button>
                  </>
                }
              >
                <ul>
                  {[
                    ["Peak breakfast", "No tomato", "TZS 18,000", 1],
                    ["Cappuccino", "Oat milk", "TZS 7,500", 2],
                    ["Chocolate tart", "", "TZS 9,500", 1],
                  ].map(([name, modifier, price, quantity]) => (
                    <OrderLine key={String(name)}>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{name}</span>
                        {modifier && <span className="block truncate text-[11px] text-[var(--foreground-muted)]">{modifier}</span>}
                        <MoneyDisplay className="mt-1 block text-[11px] text-[var(--foreground-muted)]">{price}</MoneyDisplay>
                      </span>
                      <QuantityStepper label={String(name)} value={Number(quantity)} minimum={0} onDecrease={() => undefined} onIncrease={() => undefined} />
                    </OrderLine>
                  ))}
                </ul>
              </OrderRail>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
