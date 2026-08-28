import type { DeviceIdentityRecord, DeviceKeyStorageStatus } from "./deviceIdentity";
import type { OperationalSession } from "./operationalSession";
import { getApiBaseUrl } from "./peakConfig";

export type Reachability = "reachable" | "unreachable";

export interface PeakProbe {
  status: Reachability;
  detail: string;
  origin: string;
}

export interface PrinterStatus {
  available: boolean;
  name: string | null;
}

export interface HostDiagnostics {
  os: string;
  arch: string;
  appVersion: string;
}

export interface TechnicianSnapshot {
  appVersion: string;
  os: string;
  arch: string;
  printerName: string;
  printerAvailable: boolean;
  deviceCode: string;
  deviceId: string;
  terminalName: string;
  mode: string;
  peakOrigin: string;
  keyStorageBackend: string;
  keyStorageHardwareBacked: boolean | null;
}

function tauriAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function packagedAppVersion(): string {
  return __APP_VERSION__;
}

export async function probePeakServer(
  baseUrl: string = getApiBaseUrl(),
  fetchImpl: typeof fetch = fetch,
): Promise<PeakProbe> {
  const origin = baseUrl.replace(/\/+$/, "");
  try {
    const response = await fetchImpl(origin + "/", {
      method: "GET",
      signal: AbortSignal.timeout(4_000),
    });
    return {
      status: "reachable",
      detail: `HTTP ${response.status}`,
      origin,
    };
  } catch (error) {
    return {
      status: "unreachable",
      detail: error instanceof Error ? error.message : "Could not reach Peak",
      origin,
    };
  }
}

export async function loadPrinterStatus(): Promise<PrinterStatus | null> {
  if (!tauriAvailable()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PrinterStatus>("printer_status");
}

export async function loadHostDiagnostics(): Promise<HostDiagnostics | null> {
  if (!tauriAvailable()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<HostDiagnostics>("host_diagnostics");
}

export async function loadEmbeddedVersion(
  host: HostDiagnostics | null = null,
): Promise<string> {
  const resolved = host ?? (await loadHostDiagnostics());
  return resolved?.appVersion ?? packagedAppVersion();
}

/**
 * Technician fields only. Private keys and ops tokens never belong here —
 * even if the caller still holds them on the session object.
 */
export function buildTechnicianSnapshot(input: {
  identity: DeviceIdentityRecord | null;
  session: OperationalSession | null;
  host: HostDiagnostics | null;
  printer: PrinterStatus | null;
  keyStorage: DeviceKeyStorageStatus | null;
  peakOrigin: string;
}): TechnicianSnapshot {
  return {
    appVersion: input.host?.appVersion ?? packagedAppVersion(),
    os: input.host?.os ?? (typeof navigator !== "undefined" ? navigator.platform : "unknown"),
    arch: input.host?.arch ?? "unknown",
    printerName: input.printer?.name?.trim() || "default",
    printerAvailable: input.printer?.available ?? false,
    deviceCode: input.identity?.deviceCode?.trim() || "not assigned",
    deviceId: input.session?.terminalId?.trim() || "not assigned",
    terminalName: input.identity?.terminalName?.trim() || "unnamed till",
    mode: input.identity?.mode?.trim() || "POS",
    peakOrigin: input.peakOrigin.replace(/\/+$/, ""),
    keyStorageBackend: input.keyStorage?.backend ?? "unknown",
    keyStorageHardwareBacked: input.keyStorage?.hardwareBacked ?? null,
  };
}

const SECRET_PATTERNS = [
  /privateKeyPkcs8/i,
  /privateKey/i,
  /\bops_/i,
  /"token"\s*:/i,
];

export function snapshotContainsSecrets(snapshot: TechnicianSnapshot): boolean {
  const serialized = JSON.stringify(snapshot);
  return SECRET_PATTERNS.some((pattern) => pattern.test(serialized));
}
