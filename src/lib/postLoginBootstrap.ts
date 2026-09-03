import {
  SessionExpiredError,
  type OperationalSession,
} from "./operationalSession";
import type {
  AuthorizationStageResult,
  SignedAuthorizationBundle,
} from "./offlineAuthorization";

export class PostLoginBootstrapError extends Error {
  constructor(message = "Peak could not load this register") {
    super(message);
    this.name = "PostLoginBootstrapError";
  }
}

export interface BootstrapCatalog {
  outletId: string;
  outletName: string;
  products: unknown[];
}

export interface PostLoginBootstrap {
  catalog: BootstrapCatalog;
  activeOrders: unknown[];
  offlineAuthorization?: AuthorizationStageResult | {
    state: "BACKEND_GAP" | "UNAVAILABLE" | "INVALID";
  };
}

export interface PostLoginBootstrapOptions {
  stageOfflineAuthorization?: (
    envelope: SignedAuthorizationBundle,
  ) => Promise<AuthorizationStageResult>;
}

async function getJSON(baseUrl: string, path: string, token: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new PostLoginBootstrapError(
      error instanceof Error ? `Peak register bootstrap failed: ${error.message}` : undefined,
    );
  }
  if (response.status === 401) {
    throw new SessionExpiredError();
  }
  if (!response.ok) {
    throw new PostLoginBootstrapError(`Peak register bootstrap failed with HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new PostLoginBootstrapError("Peak register bootstrap returned invalid JSON");
  }
}

export async function bootstrapOperationalSession(
  baseUrl: string,
  session: OperationalSession,
  options: PostLoginBootstrapOptions = {},
): Promise<PostLoginBootstrap> {
  const rawCatalog = await getJSON(baseUrl, "/api/v1/pos/catalog", session.token);
  if (!rawCatalog || typeof rawCatalog !== "object") {
    throw new PostLoginBootstrapError("Peak register bootstrap returned an invalid catalog");
  }
  const catalog = rawCatalog as Partial<BootstrapCatalog>;
  if (
    catalog.outletId !== session.outletId ||
    typeof catalog.outletName !== "string" ||
    !Array.isArray(catalog.products)
  ) {
    throw new PostLoginBootstrapError(
      "Peak catalog does not match the authenticated outlet",
    );
  }

  const rawOrders = await getJSON(
    baseUrl,
    "/api/v1/pos/orders?active=true",
    session.token,
  );
  if (!Array.isArray(rawOrders)) {
    throw new PostLoginBootstrapError("Peak register bootstrap returned invalid active orders");
  }
  const result: PostLoginBootstrap = {
    catalog: catalog as BootstrapCatalog,
    activeOrders: rawOrders,
  };

  if (options.stageOfflineAuthorization) {
    result.offlineAuthorization = await bootstrapOfflineAuthorization(
      baseUrl,
      session,
      options.stageOfflineAuthorization,
    );
  }
  return result;
}

async function bootstrapOfflineAuthorization(
  baseUrl: string,
  session: OperationalSession,
  stage: (envelope: SignedAuthorizationBundle) => Promise<AuthorizationStageResult>,
): Promise<PostLoginBootstrap["offlineAuthorization"]> {
  let response: Response;
  try {
    response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/api/v1/pos/terminals/${encodeURIComponent(session.terminalId)}/offline-leases`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ staffId: session.staffId }),
      },
    );
  } catch {
    return { state: "UNAVAILABLE" };
  }

  if (response.status === 401) throw new SessionExpiredError();
  if (response.status === 404 || response.status === 501) {
    return { state: "BACKEND_GAP" };
  }
  if (!response.ok) return { state: "UNAVAILABLE" };

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { state: "UNAVAILABLE" };
  }
  if (!isSignedAuthorizationBundle(raw)) return { state: "UNAVAILABLE" };
  try {
    return await stage(raw);
  } catch {
    return { state: "INVALID" };
  }
}

function isSignedAuthorizationBundle(value: unknown): value is SignedAuthorizationBundle {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SignedAuthorizationBundle>;
  return (
    typeof candidate.keyId === "string" &&
    candidate.keyId.length > 0 &&
    typeof candidate.payloadB64 === "string" &&
    candidate.payloadB64.length > 0 &&
    typeof candidate.signatureB64 === "string" &&
    candidate.signatureB64.length > 0
  );
}
