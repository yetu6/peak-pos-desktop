import {
  SessionExpiredError,
  type OperationalSession,
} from "./operationalSession";

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
  return {
    catalog: catalog as BootstrapCatalog,
    activeOrders: rawOrders,
  };
}
