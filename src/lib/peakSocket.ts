import { REALTIME_BRIDGE_URL } from "./env";
import { getOperationalSession } from "./operationalSession";
import { NativePeakSocket } from "./nativePeakSocket";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Packaged / `tauri dev` talks to Peak directly. Vite-in-browser uses the bridge. */
export function usesRealtimeBridge(): boolean {
  return !isTauriRuntime();
}

export function peakWsConnectUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws-connect";
  url.search = "";
  url.hash = "";
  const href = url.toString();
  if (href.includes("?")) {
    throw new Error("Peak WebSocket URL must not include a query string");
  }
  return href;
}

export function peakWebsocketOrigin(
  configured: string | undefined = import.meta.env.VITE_PEAK_WS_ORIGIN as string | undefined,
): string {
  const override = configured?.trim();
  if (override) return override;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:5173";
}

/** Bearer + Origin only. Never X-Peak-*. Never a query-string token. */
export function nativeStompHeaders(args: {
  token: string;
  origin: string;
}): { Authorization: string; Origin: string } {
  if (!args.token.startsWith("ops_")) {
    throw new Error("Native STOMP requires an ops_ session");
  }
  if (!args.origin.trim()) {
    throw new Error("Native STOMP requires a valid Origin");
  }
  return {
    Authorization: `Bearer ${args.token}`,
    Origin: args.origin.trim(),
  };
}

export function createRealtimeSocket(options: {
  peakApiUrl: string;
  token?: string | null;
  bridgeUrl?: string;
  origin?: string;
}): WebSocket {
  if (usesRealtimeBridge()) {
    return new WebSocket(options.bridgeUrl ?? REALTIME_BRIDGE_URL);
  }
  const token = options.token ?? getOperationalSession()?.token ?? "";
  const headers = nativeStompHeaders({
    token,
    origin: options.origin ?? peakWebsocketOrigin(),
  });
  return new NativePeakSocket(peakWsConnectUrl(options.peakApiUrl), headers) as unknown as WebSocket;
}
