import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ownOrdersOnlyFor, useOwnOrdersOnly } from "./usePosData";
import { clearOperationalSession, setOperationalSession } from "../lib/operationalSession";
import type { POSCatalog } from "../lib/posContracts";

const WAITER = ["pos.order.read", "pos.order.create"];
const CASHIER = [...WAITER, "pos.order.read_all"];

describe("ownOrdersOnlyFor", () => {
  it("follows the permission until the catalog says", () => {
    expect(ownOrdersOnlyFor(WAITER, undefined)).toBe(true);
    expect(ownOrdersOnlyFor(CASHIER, undefined)).toBe(false);
  });
  it("lets the catalog decide once it has loaded: switch off means all", () => {
    expect(ownOrdersOnlyFor(WAITER, false)).toBe(false);
    expect(ownOrdersOnlyFor(WAITER, true)).toBe(true);
    expect(ownOrdersOnlyFor(CASHIER, false)).toBe(false);
  });
});

function Probe() {
  return <span data-testid="scope">{useOwnOrdersOnly() ? "Yours" : "All"}</span>;
}

function words(permissions: string[], catalog: Partial<POSCatalog> | null): string {
  setOperationalSession({
    token: "t", expiresAt: "2099-01-01T00:00:00Z", tenantId: "tenant-1", propertyId: "property-1", outletId: "outlet-1",
    terminalId: "terminal-1", staffId: "staff-1", assurance: "RESTRICTED", capabilities: ["CORE", "POS"], permissions,
  });
  const client = new QueryClient();
  if (catalog) client.setQueryData(["pos", "catalog", "property-1", "outlet-1"], catalog);
  render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  return screen.getByTestId("scope").textContent ?? "";
}

describe("useOwnOrdersOnly", () => {
  afterEach(() => clearOperationalSession());
  it("a waiter gets 'Yours' while the outlet keeps the rule on", () => {
    expect(words(WAITER, { ownOrdersOnly: true })).toBe("Yours");
  });
  it("a waiter gets the 'All' wording when the outlet turned the rule off", () => {
    expect(words(WAITER, { ownOrdersOnly: false })).toBe("All");
  });
  it("a cashier always gets 'All'", () => {
    expect(words(CASHIER, { ownOrdersOnly: false })).toBe("All");
  });
  it("without a loaded catalog the permission decides", () => {
    expect(words(WAITER, null)).toBe("Yours");
  });
});
