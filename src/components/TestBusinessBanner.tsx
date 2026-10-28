import { useQuery } from "@tanstack/react-query";
import type { POSCatalog } from "../lib/posContracts";
import { cachedTestBusiness } from "../lib/testBusiness";
import { getOperationalSession } from "../lib/operationalSession";
import { Banner } from "./system";

export const TEST_BUSINESS_BANNER = "Test business — sales here are not real.";

/**
 * Shown on every screen of a test business, the lock and sign-in screens
 * included, and never dismissed. A fresh catalogue decides; until one has
 * loaded (or offline) the answer this till last kept does.
 */
export function TestBusinessBanner() {
  const session = getOperationalSession();
  // Reads the catalogue the till already loaded; never fetches it.
  const catalog = useQuery<POSCatalog>({ queryKey: ["pos", "catalog", session?.propertyId, session?.outletId], enabled: false });
  const says = catalog.data?.testBusiness;
  const test = typeof says === "boolean" ? says : cachedTestBusiness(session?.propertyId, session?.outletId);
  if (!test) return null;
  return <Banner tone="warning" data-testid="test-business-banner">{TEST_BUSINESS_BANNER}</Banner>;
}
