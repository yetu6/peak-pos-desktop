import { createPeakHospitalityApiClient } from "@peak/hospitality-api-client";
import { devIdentityFromEnv, type DevIdentity } from "./env";
import { getApiBaseUrl } from "./peakConfig";
import { getOperationalSession } from "./operationalSession";
import { restRequestHeaders } from "./restAuth";

function tryDevIdentity(): DevIdentity | null {
  try {
    return devIdentityFromEnv();
  } catch {
    return null;
  }
}

/**
 * Shared hospitality API client. After PIN, uses Bearer `ops_…` when Peak's
 * login JSON included tenantId, userId and propertyId (outletId may be null).
 * Otherwise keeps the header-identity loop. Never sends both.
 */
export function createApiClient() {
  return createPeakHospitalityApiClient({
    baseUrl: getApiBaseUrl(),
    headers: restRequestHeaders(getOperationalSession(), tryDevIdentity()),
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
