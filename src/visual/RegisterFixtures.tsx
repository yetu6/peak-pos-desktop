import { Tile, TicketLine } from "../components/system";
import { formatMoney } from "../lib/money";
import { RegisterLayout } from "../register/RegisterLayout";
import { FixtureShell } from "./ShellFixtures";

/**
 * Development-only Sell compositions for the pixel harness: the register's
 * real layout with data in the backend's shapes. Nothing here talks to a
 * server.
 */

const CURRENCY = "TZS";

const MENU: ReadonlyArray<[string, number]> = [
  ["Cappuccino", 650_000],
  ["Flat white", 700_000],
  ["Passion cooler", 550_000],
  ["Full breakfast", 1_800_000],
  ["Avocado toast", 1_450_000],
  ["House burger", 2_200_000],
  ["Grilled chicken", 2_500_000],
  ["Coconut curry", 2_150_000],
  ["Seasonal salad", 1_600_000],
  ["Chocolate tart", 950_000],
  ["Sparkling water", 400_000],
  ["Fresh juice", 600_000],
];

/** Sell: the menu beside the ticket. */
export function RegisterFixture() {
  return (
    <FixtureShell initialPage="new" workspaceVariant="full">
      <RegisterLayout
        menu={
          <div className="y-menu-grid" data-testid="menu-grid">
            {MENU.map(([name, price]) => (
              <Tile key={name} name={name} price={formatMoney(price, CURRENCY)} />
            ))}
          </div>
        }
        ticket={
          <div>
            <TicketLine quantity={2} name="Cappuccino" amount={formatMoney(1_534_000, CURRENCY)} />
            <TicketLine quantity={1} name="House burger" options={["Medium", "No onions"]} amount={formatMoney(2_596_000, CURRENCY)} />
          </div>
        }
      />
    </FixtureShell>
  );
}
