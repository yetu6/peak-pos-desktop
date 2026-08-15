const CONFIG_KEY = "peak-pos-api-url";

export interface UrlCheck {
  ok: true;
  url: string;
}

export interface UrlReject {
  ok: false;
  error: string;
}

function tauriAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * One binary for all hotels: the operator types Peak's address on first boot.
 * HTTPS is required except for localhost during development.
 */
export function validatePeakApiUrl(raw: string): UrlCheck | UrlReject {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return { ok: false, error: "Enter the Peak server address." };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "That does not look like a server address." };
  }
  const local =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (parsed.protocol === "https:") {
    return { ok: true, url: parsed.origin };
  }
  if (parsed.protocol === "http:" && local) {
    return { ok: true, url: parsed.origin };
  }
  if (parsed.protocol === "http:") {
    return { ok: false, error: "Use HTTPS for a live hotel. HTTP is only for localhost." };
  }
  return { ok: false, error: "Use an https:// address (or http://localhost for development)." };
}

let configured: string | null = null;

export function getConfiguredApiUrl(): string | null {
  return configured;
}

export function setConfiguredApiUrl(url: string | null): void {
  configured = url;
}

export async function loadPeakApiUrl(): Promise<string | null> {
  if (tauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const stored = await invoke<string | null>("load_peak_config");
    if (stored) {
      const check = validatePeakApiUrl(stored);
      if (check.ok) {
        configured = check.url;
        return check.url;
      }
    }
  }
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) {
      const check = validatePeakApiUrl(stored);
      if (check.ok) {
        configured = check.url;
        return check.url;
      }
    }
  }
  return configured;
}

export async function savePeakApiUrl(url: string): Promise<string> {
  const check = validatePeakApiUrl(url);
  if (!check.ok) throw new Error(check.error);
  configured = check.url;
  if (tauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_peak_config", { payload: check.url });
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(CONFIG_KEY, check.url);
  }
  return check.url;
}

export function getApiBaseUrl(): string {
  if (configured) return configured;
  return (
    (import.meta.env.VITE_PEAK_API_URL as string | undefined) ?? "http://localhost:8080"
  );
}
