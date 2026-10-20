import { noteRequestTime } from "./requestTimes";

/**
 * Every request to Yetu goes through here (F-255, 2026-10-20). In the till it
 * is sent from the native side (src-tauri/src/yetu_http.rs): one client kept
 * for the whole run reuses its connections, and needs no permission check
 * (CORS preflight) before the first request to each new address. From the web
 * view an add took 0.8–1.6 s on Bahari's Linux till though Yetu answered in
 * under 0.1 s. Elsewhere (tests, visual fixtures, a browser) it is fetch.
 *
 * It also notes how long each answer took, for the details for support.
 */
interface YetuAnswer {
  status: number;
  headers: [string, string][];
  body: string;
}

/** Statuses whose answer has no body (the Response constructor refuses one). */
const NO_BODY = new Set([101, 204, 205, 304]);

function inTill(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function yetuFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const asked = performance.now();
  const response = inTill() ? await nativeFetch(url, method, init) : await fetch(url, init);
  noteRequestTime(method, performance.now() - asked);
  return response;
}

async function nativeFetch(url: string, method: string, init: RequestInit): Promise<Response> {
  if (init.body !== undefined && init.body !== null && typeof init.body !== "string") {
    throw new Error("Yetu requests send JSON text");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const sent = invoke<YetuAnswer>("yetu_request", {
    request: {
      method,
      url,
      headers: [...new Headers(init.headers).entries()],
      body: init.body ?? null,
    },
  });
  let answer: YetuAnswer;
  try {
    answer = await (init.signal ? untilAborted(sent, init.signal) : sent);
  } catch (error) {
    if (init.signal?.aborted) throw init.signal.reason;
    // As a browser says it, so every "can't reach Yetu" check reads it the same.
    throw new TypeError(`Failed to fetch: ${String(error)}`);
  }
  return new Response(NO_BODY.has(answer.status) ? null : answer.body, {
    status: answer.status,
    headers: answer.headers,
  });
}

/** A native request can't be called back; the till stops waiting for it. */
function untilAborted<T>(sent: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    sent.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}
