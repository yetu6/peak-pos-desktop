export interface DevIdentity {
  tenantId: string;
  userId: string;
  propertyId: string;
  /** Single-outlet deployment: the outlet the POS app operates. */
  outletId: string;
}

/**
 * Dev-only bootstrap identity. Production identity comes from the signed
 * session bootstrap (`GET /api/v1/session`); these values are the header
 * identity the dev runtime accepts (PEAK_ALLOW_HEADER_IDENTITY=true).
 */
export function devIdentityFromEnv(): DevIdentity {
  const tenantId = import.meta.env.VITE_PEAK_TENANT_ID;
  const userId = import.meta.env.VITE_PEAK_USER_ID;
  const propertyId = import.meta.env.VITE_PEAK_PROPERTY_ID;
  const outletId = import.meta.env.VITE_PEAK_OUTLET_ID;
  if (!tenantId || !userId || !propertyId || !outletId) {
    throw new Error(
      "VITE_PEAK_TENANT_ID, VITE_PEAK_USER_ID, VITE_PEAK_PROPERTY_ID and VITE_PEAK_OUTLET_ID must be set",
    );
  }
  return { tenantId, userId, propertyId, outletId };
}

export const API_BASE_URL: string =
  (import.meta.env.VITE_PEAK_API_URL as string | undefined) ??
  "http://localhost:8080";

export const REALTIME_BRIDGE_URL: string =
  (import.meta.env.VITE_PEAK_REALTIME_BRIDGE_URL as string | undefined) ??
  "ws://localhost:5174/bridge";

/**
 * The browser cannot put identity headers on a WebSocket handshake. The
 * realtime-bridge process does that, using either VITE_PEAK_* headers (the
 * existing POS loop) or PEAK_OPS_TOKEN for a device-bound PIN session.
 */