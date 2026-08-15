import type { DevIdentity } from "./env";
import type { OperationalSession } from "./operationalSession";

/**
 * Peak PIN login returns tenantId, userId, propertyId, and a nullable outletId.
 * Bearer REST is used when the ops token plus tenant/user/property are present.
 * outletId is not required for auth — it only scopes the till. Never send
 * Authorization together with X-Peak-* headers.
 */
export function hasBearerIdentity(session: OperationalSession | null): boolean {
  return Boolean(
    session?.token.startsWith("ops_") &&
      session.tenantId &&
      session.userId &&
      session.propertyId,
  );
}

export function restRequestHeaders(
  session: OperationalSession | null,
  env: DevIdentity | null,
): Record<string, string> {
  if (hasBearerIdentity(session)) {
    return {
      Authorization: `Bearer ${session!.token}`,
      "Content-Type": "application/json",
    };
  }
  if (!env) {
    return { "Content-Type": "application/json" };
  }
  return {
    "X-Peak-Tenant-Id": env.tenantId,
    "X-Peak-Tenant-User-Id": env.userId,
    "Content-Type": "application/json",
  };
}

/**
 * Backfill must authenticate the same way as the STOMP socket: ops token XOR
 * identity headers, never both. After PIN the socket is token-only, so replay
 * is token-only even when Peak omitted outletId (Bearer REST still needs it).
 */
export function socketAlignedHeaders(
  session: OperationalSession | null,
  env: DevIdentity | null,
): Record<string, string> {
  if (session?.token.startsWith("ops_")) {
    return { Authorization: `Bearer ${session.token}` };
  }
  if (!env) {
    return {};
  }
  return {
    "X-Peak-Tenant-Id": env.tenantId,
    "X-Peak-Tenant-User-Id": env.userId,
  };
}

export function registerPropertyId(
  session: OperationalSession | null,
  env: DevIdentity | null,
): string | undefined {
  return session?.propertyId ?? env?.propertyId;
}

export function registerOutletId(
  session: OperationalSession | null,
  env: DevIdentity | null,
): string | undefined {
  return session?.outletId ?? env?.outletId;
}
