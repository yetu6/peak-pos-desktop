import { KitchenBoard, type KitchenBoardProps } from "../kitchen/KitchenBoard";
import { ticketsFromOrders, ticketsFromStations } from "../kitchen/kitchenTickets";
import { stationWords } from "../kitchen/kitchenWords";
import { FIXTURE_NOW, LONG_TICKETS, OPEN_ORDERS, STATION_TICKETS } from "./ordersData";
import { FixtureShell } from "./ShellFixtures";

/**
 * Development-only kitchen and bar compositions for the pixel harness: the
 * real board with tickets in the backend's shapes (ordersData.ts), seen at
 * the fixtures' moment. Nothing here talks to a server.
 */

const nothing = () => undefined;
const ORDER_TICKETS = ticketsFromOrders(OPEN_ORDERS, STATION_TICKETS);
const DISPLAY_TICKETS = ticketsFromStations(STATION_TICKETS);
const STATIONS = ["GRILL", "BAR"];

function Board({ mode = "POS", ...props }: Partial<KitchenBoardProps> & { mode?: string }) {
  return (
    <FixtureShell mode={mode} initialPage="kitchen" workspaceVariant="full">
      <KitchenBoard title="Kitchen" tickets={ORDER_TICKETS} nowMs={FIXTURE_NOW} busyIds={new Set()} canMove onNextStep={nothing} {...props} />
    </FixtureShell>
  );
}

/** A selling till's kitchen: new, getting late, late, preparing and ready, with what just happened. */
export function KitchenFixture() {
  return <Board result="Order 42 is ready." />;
}

/** A kitchen display with a second round (S17a): its ticket says Round 2. */
export function KitchenRoundsFixture() {
  const rounds = DISPLAY_TICKETS.map((ticket, index) => (index === 0 ? { ...ticket, roundNumber: 2 } : ticket));
  return <Board mode="KITCHEN_DISPLAY" tickets={rounds} stationsWords={STATIONS.map(stationWords).join(" · ")} />;
}

/** Nothing waiting. */
export function KitchenEmptyFixture() {
  return <Board tickets={[]} />;
}

/** A kitchen display set to the grill and the bar: full screen, one station at a time if chosen. */
export function KitchenDisplayFixture() {
  return (
    <Board
      mode="KITCHEN_DISPLAY"
      tickets={DISPLAY_TICKETS}
      stationsWords={STATIONS.map(stationWords).join(" · ")}
      stationFilter={{
        options: [{ value: "ALL", label: "All stations" }, ...STATIONS.map((value) => ({ value, label: stationWords(value) }))],
        value: "ALL",
        onChange: nothing,
      }}
    />
  );
}

/** A busy display: a ticket taller than its column, one on its way to Yetu, and a refusal. */
export function KitchenBusyFixture() {
  const tickets = ticketsFromStations([...LONG_TICKETS, ...STATION_TICKETS]);
  return (
    <Board
      mode="KITCHEN_DISPLAY"
      tickets={tickets}
      busyIds={new Set([tickets.find((ticket) => ticket.status === "PREPARING")!.id])}
      problem="Someone moved this ticket on another screen. The board shows the latest now."
    />
  );
}

/** A person who can't move tickets on. */
export function KitchenLimitedFixture() {
  return <Board canMove={false} />;
}

/** The tickets being asked for. */
export function KitchenLoadingFixture() {
  return <Board tickets={[]} loading />;
}

/** The tickets couldn't be loaded again; the last ones stay on screen. */
export function KitchenErrorFixture() {
  return <Board failed />;
}
