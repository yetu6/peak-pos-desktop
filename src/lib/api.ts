import { createPeakHospitalityApiClient } from "@peak/hospitality-api-client";
import { API_BASE_URL, devIdentityFromEnv } from "./env";

/**
 * Single shared API client. Every request carries the dev header identity so
 * the runtime resolves the same tenant context REST and WebSocket share.
 */
export function createApiClient() {
  return createPeakHospitalityApiClient({
    baseUrl: API_BASE_URL,
    headers: {
      "X-Peak-Tenant-Id": devIdentityFromEnv().tenantId,
      "X-Peak-Tenant-User-Id": devIdentityFromEnv().userId,
      "Content-Type": "application/json",
    },
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;