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

export type ApiResult<T> = { data?: T; error?: unknown; response: Response };

async function request<T>(method: string, path: string, options: Record<string, any> = {}): Promise<ApiResult<T>> {
  const pathValues = options.params?.path ?? {};
  let resolvedPath = path.replace(/\{([^}]+)\}/g, (_match, key: string) => encodeURIComponent(String(pathValues[key])));
  const query = options.params?.query;
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    });
    const encoded = params.toString();
    if (encoded) resolvedPath += `?${encoded}`;
  }
  const headers = { ...restRequestHeaders(getOperationalSession(), tryDevIdentity()), ...options.headers };
  const response = await fetch(`${getApiBaseUrl()}${resolvedPath}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  // Yetu writes refusals as application/problem+json: JSON too. Read as text,
  // a refusal lost its code on the way to the screen's words.
  const json = /application\/([\w.-]+\+)?json/.test(contentType);
  const payload = response.status === 204 ? undefined : json ? await response.json() : await response.text();
  if (!response.ok) return { error: withRetryAfter(payload ?? response.statusText, response), response };
  return { data: payload as T, response };
}

/** A 429 keeps how long Yetu asked the till to wait (its Retry-After, in seconds). */
function withRetryAfter(error: unknown, response: Response): unknown {
  if (response.status !== 429 || !error || typeof error !== "object") return error;
  const header = response.headers.get("Retry-After");
  const seconds = header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) : undefined;
  return seconds === undefined ? error : { ...error, retryAfterSeconds: seconds };
}

/** Small transport used by the Tauri adapter; business contracts live in posApi. */
export function createApiClient() {
  return {
    GET: <T = any>(path: string, options?: Record<string, any>) => request<T>("GET", path, options),
    POST: <T = any>(path: string, options?: Record<string, any>) => request<T>("POST", path, options),
    DELETE: <T = any>(path: string, options?: Record<string, any>) => request<T>("DELETE", path, options),
    PATCH: <T = any>(path: string, options?: Record<string, any>) => request<T>("PATCH", path, options),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
