import { cacheOutletMoney } from "./outletMoneySettings";
import { cacheOutletOrderSettings } from "./outletOrderSettings";
import {
  SessionExpiredError,
  type OperationalSession,
} from "./operationalSession";
import type { AuthorizationStageResult } from "./offlineAuthorization";
import type { CatalogActivationResult } from "./localPosCore";
import { yetuFetch } from "./yetuFetch";

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

/**
 * What sign-in reads before the till opens: the outlet's catalogue, and the
 * offline start-up when the native store is there. The open orders are not
 * read here: the orders list reads every page of them itself
 * (useActiveOrders). This read once asked for ?active=true, a list Yetu
 * bounds without a next page, and threw the answer away (2026-10-27).
 */
export interface PostLoginBootstrap {
  catalog: BootstrapCatalog;
  offlineAuthorization?: AuthorizationStageResult | {
    state: "BACKEND_GAP" | "UNAVAILABLE" | "INVALID";
  };
  certifiedCatalog?: CatalogActivationResult | { state: "BACKEND_GAP" | "UNAVAILABLE" | "INVALID" };
}

export interface OfflineStartOptions {
  installOfflineBootstrap?: (expectedTerminalId:string,expectedPropertyId:string,expectedOutletId:string,bootstrap:unknown)=>Promise<{authorization:AuthorizationStageResult;catalog:CatalogActivationResult}>;
  /**
   * Fetches and installs Yetu's offline keys (retry_sync) first: a new till
   * has none, and without them it can't check the start-up's signatures, so
   * its lease stayed STAGED and its catalogue MISSING (F-228). It also tells
   * the till it reached Yetu, so a reachable till isn't called Offline.
   */
  installTrustKeyset?: () => Promise<unknown>;
}

/**
 * The offline start-up comes from POST /pos/offline/bootstrap only
 * (prepareOfflineStart). The till once also asked
 * /pos/terminals/{id}/offline-leases and /pos/catalog/snapshots/{version}
 * when the native store was missing: Yetu has neither route, so each sign-in
 * there made two requests that could only answer 404 (2026-10-27).
 */
export type PostLoginBootstrapOptions = OfflineStartOptions;

async function getJSON(baseUrl: string, path: string, token: string): Promise<unknown> {
  let response: Response;
  try {
    response = await yetuFetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
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

  cacheOutletMoney(session.propertyId, session.outletId, catalog);
  cacheOutletOrderSettings(session.propertyId, session.outletId, catalog);
  const result: PostLoginBootstrap = {
    catalog: catalog as BootstrapCatalog,
  };

  if (options.installOfflineBootstrap) {
    return { ...result, ...(await prepareOfflineStart(baseUrl, session, options)) };
  }

  return result;
}

/**
 * The till's offline start-up (POST /pos/offline/bootstrap): its lease and
 * signed catalogue, installed in the local store. Yetu gives one only while a
 * shift is open on the till (409 before), so it is asked for at sign-in and
 * again when a shift opens (F-228).
 */
export async function prepareOfflineStart(
  baseUrl: string,
  session: OperationalSession,
  options: OfflineStartOptions,
): Promise<Pick<PostLoginBootstrap, "offlineAuthorization" | "certifiedCatalog">> {
  if (!options.installOfflineBootstrap) return {};
  if (options.installTrustKeyset) {
    try { await options.installTrustKeyset(); } catch { /* the start-up below then says it can't be checked */ }
  }
  let response:Response;
  try { response=await yetuFetch(`${baseUrl.replace(/\/$/, "")}/api/v1/pos/offline/bootstrap`,{method:"POST",headers:{Authorization:`Bearer ${session.token}`,"Content-Type":"application/json"},body:"{}"}); }
  catch { return {offlineAuthorization:{state:"UNAVAILABLE"}}; }
  if(response.status===401)throw new SessionExpiredError();
  if(response.status===404||response.status===501)return {offlineAuthorization:{state:"BACKEND_GAP"}};
  if(!response.ok)return {offlineAuthorization:{state:"UNAVAILABLE"}};
  try{
    const bootstrap:unknown=await response.json();
    const installed=await options.installOfflineBootstrap(session.terminalId,session.propertyId,session.outletId,bootstrap);
    await yetuFetch(`${baseUrl.replace(/\/$/, "")}/api/v1/pos/offline/catalog-acknowledge`,{method:"POST",headers:{Authorization:`Bearer ${session.token}`,"Content-Type":"application/json"},body:JSON.stringify({catalogSnapshotId:installed.catalog.snapshotId,activatedAtMs:Date.now()})});
    return {offlineAuthorization:installed.authorization,certifiedCatalog:installed.catalog};
  }catch{return {offlineAuthorization:{state:"INVALID"}}}
}

