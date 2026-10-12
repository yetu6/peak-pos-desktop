import { useState } from "react";
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
import { shiftChipWords } from "../lib/words";
import type { WorkspacePage } from "../lib/workspace";
import { TillShell } from "../shell/TillShell";

/** A shift as the backend sends it: opened 07:02 on business day 2026-10-12. */
const BUSINESS_DATE = "2026-10-12";
const OPENED_AT = new Date(2026, 9, 12, 7, 2).toISOString();

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

/**
 * Development-only composition used to capture deterministic viewport
 * evidence: the existing register content (redesigned in S4) inside the new
 * till shell.
 */
export function PeakTerminalFixture() {
  const [page, setPage] = useState<WorkspacePage>("new");
  return (
    <TillShell
      mode="POS"
      page={page}
      onNavigate={setPage}
      tillName="Main Restaurant"
      person={{ name: "Amina Hassan", initials: "AH" }}
      shift={shiftChipWords({ status: "OPEN", openedAt: OPENED_AT, businessDate: BUSINESS_DATE })}
      clock="14:32"
      connection={<OperationalStatus tone="success" announce>Live</OperationalStatus>}
      onSwitchPerson={() => undefined}
      onLock={() => undefined}
      workspaceVariant="full"
    >
      <div className="new-order-screen">
        <div className="new-order-header">
          <div>
            <h1 className="text-lg font-bold tracking-[-0.02em]">Register</h1>
            <p className="text-xs text-[var(--foreground-muted)]">Live catalog · ticket settles exactly</p>
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
            title="Ticket"
            className="receipt-ticket"
            headerMeta={<p className="mt-1 text-xs text-[var(--foreground-muted)]">3 items · Table 12</p>}
            footer={
              <>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <span className="text-xs text-[var(--foreground-muted)]">Total</span>
                  <MoneyDisplay prominence="strong" className="text-lg text-[var(--brass)]">TZS 42,500</MoneyDisplay>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-secondary w-full"><Icon name="orders" size={17} />Send</button>
                  <button className="btn-pay w-full">Pay</button>
                </div>
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
    </TillShell>
  );
}
