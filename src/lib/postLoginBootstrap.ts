import {
  SessionExpiredError,
  type OperationalSession,
} from "./operationalSession";
import type {
  AuthorizationStageResult,
  SignedAuthorizationBundle,
} from "./offlineAuthorization";
import type { CatalogActivationResult, SignedCatalogSnapshot } from "./localPosCore";

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

export interface PostLoginBootstrapOptions extends OfflineStartOptions {
  stageOfflineAuthorization?: (
    envelope: SignedAuthorizationBundle,
  ) => Promise<AuthorizationStageResult>;
  installCatalogSnapshot?: (envelope: SignedCatalogSnapshot) => Promise<CatalogActivationResult>;
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

  if (options.installOfflineBootstrap) {
    return { ...result, ...(await prepareOfflineStart(baseUrl, session, options)) };
  }

  if (options.stageOfflineAuthorization) {
    result.offlineAuthorization = await bootstrapOfflineAuthorization(
      baseUrl,
      session,
      options.stageOfflineAuthorization,
    );
    if (
      result.offlineAuthorization?.state === "STAGED" &&
      result.offlineAuthorization.prerequisite === "CATALOG_REQUIRED" &&
      options.installCatalogSnapshot
    ) {
      result.certifiedCatalog = await bootstrapCertifiedCatalog(
        baseUrl,
        session,
        result.offlineAuthorization.catalogVersion,
        result.offlineAuthorization.catalogDigest,
        options.installCatalogSnapshot,
      );
    }
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
  try { response=await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/pos/offline/bootstrap`,{method:"POST",headers:{Authorization:`Bearer ${session.token}`,"Content-Type":"application/json"},body:"{}"}); }
  catch { return {offlineAuthorization:{state:"UNAVAILABLE"}}; }
  if(response.status===401)throw new SessionExpiredError();
  if(response.status===404||response.status===501)return {offlineAuthorization:{state:"BACKEND_GAP"}};
  if(!response.ok)return {offlineAuthorization:{state:"UNAVAILABLE"}};
  try{
    const bootstrap:unknown=await response.json();
    const installed=await options.installOfflineBootstrap(session.terminalId,session.propertyId,session.outletId,bootstrap);
    await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/pos/offline/catalog-acknowledge`,{method:"POST",headers:{Authorization:`Bearer ${session.token}`,"Content-Type":"application/json"},body:JSON.stringify({catalogSnapshotId:installed.catalog.snapshotId,activatedAtMs:Date.now()})});
    return {offlineAuthorization:installed.authorization,certifiedCatalog:installed.catalog};
  }catch{return {offlineAuthorization:{state:"INVALID"}}}
}

async function bootstrapCertifiedCatalog(
  baseUrl: string,
  session: OperationalSession,
  version: string,
  expectedDigest: string,
  install: (envelope: SignedCatalogSnapshot) => Promise<CatalogActivationResult>,
): Promise<PostLoginBootstrap["certifiedCatalog"]> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/pos/catalog/snapshots/${encodeURIComponent(version)}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
  } catch { return { state: "UNAVAILABLE" }; }
  if (response.status === 401) throw new SessionExpiredError();
  if (response.status === 404 || response.status === 501) return { state: "BACKEND_GAP" };
  if (!response.ok) return { state: "UNAVAILABLE" };
  let raw: unknown;
  try { raw = await response.json(); } catch { return { state: "INVALID" }; }
  if (!isSignedCatalogSnapshot(raw) || raw.digest !== expectedDigest) return { state: "INVALID" };
  try { return await install(raw); } catch { return { state: "INVALID" }; }
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
    typeof (candidate.kid??(candidate as unknown as {keyId?:string}).keyId) === "string" &&
    typeof candidate.payloadB64 === "string" &&
    candidate.payloadB64.length > 0 &&
    typeof candidate.signatureB64 === "string" &&
    candidate.signatureB64.length > 0
  );
}

function isSignedCatalogSnapshot(value: unknown): value is SignedCatalogSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate=value as Partial<SignedCatalogSnapshot>;
  return typeof (candidate.kid??(candidate as unknown as {keyId?:string}).keyId)==="string"&&typeof candidate.digest==="string"&&candidate.digest.length===64&&typeof candidate.payloadB64==="string"&&candidate.payloadB64.length>0&&typeof candidate.signatureB64==="string"&&candidate.signatureB64.length>0;
}
