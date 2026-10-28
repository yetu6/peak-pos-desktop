import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TestBusinessBanner, TEST_BUSINESS_BANNER } from "./TestBusinessBanner";
import { clearOperationalSession, setOperationalSession } from "../lib/operationalSession";
import { cacheTestBusiness } from "../lib/testBusiness";
import type { POSCatalog } from "../lib/posContracts";

function show(catalog: Partial<POSCatalog> | null, signedIn = true) {
  if (signedIn) setOperationalSession({ token: "t", expiresAt: "2099-01-01T00:00:00Z", tenantId: "t", propertyId: "p1", outletId: "o1", terminalId: "x", staffId: "s", assurance: "RESTRICTED", capabilities: ["CORE"], permissions: [] });
  const client = new QueryClient();
  if (catalog) client.setQueryData(["pos", "catalog", "p1", "o1"], catalog);
  render(<QueryClientProvider client={client}><TestBusinessBanner /></QueryClientProvider>);
}

describe("the test business banner", () => {
  afterEach(() => { clearOperationalSession(); localStorage.clear(); });
  it("shows when the catalogue says test business, as a status that cannot be dismissed", () => {
    show({ testBusiness: true });
    expect(screen.getByRole("status")).toHaveTextContent(TEST_BUSINESS_BANNER);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("is absent for a normal business, and when the catalogue does not say", () => {
    show({ testBusiness: false });
    expect(screen.queryByTestId("test-business-banner")).toBeNull();
  });
  it("is absent with nothing known", () => {
    show(null);
    expect(screen.queryByTestId("test-business-banner")).toBeNull();
  });
  it("stays up offline from the remembered answer, and on the lock screen", () => {
    cacheTestBusiness("p1", "o1", true);
    show(null, false);
    expect(screen.getByTestId("test-business-banner")).toBeInTheDocument();
  });
  it("a fresh false beats the remembered true", () => {
    cacheTestBusiness("p1", "o1", true);
    show({ testBusiness: false });
    expect(screen.queryByTestId("test-business-banner")).toBeNull();
  });
});
