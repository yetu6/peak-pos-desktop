export interface PairingRecord {
  pairingRequestId: string;
  pairingCode: string;
  fingerprint: string;
  expiresAt: string;
}

export interface DeviceIdentityRecord {
  privateKeyPkcs8: string;
  publicKeySpki: string;
  deviceCode?: string;
  approved?: boolean;
  pairing?: PairingRecord;
  mode?: string;
  terminalName?: string;
}

export interface SecretStore {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
}

export interface DeviceKeyStorageStatus {
  hardwareBacked: boolean;
  backend: string;
  warning: string | null;
}

const LOCAL_KEY = "peak-pos-device-identity";

export function localStorageSecretStore(
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): SecretStore {
  return {
    async load() {
      return storage.getItem(LOCAL_KEY);
    },
    async save(value: string) {
      storage.setItem(LOCAL_KEY, value);
    },
  };
}

function tauriAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function defaultStore(): Promise<SecretStore> {
  if (tauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return {
      async load() {
        return invoke<string | null>("load_device_identity");
      },
      async save(value: string) {
        await invoke("save_device_identity", { payload: value });
      },
    };
  }
  return localStorageSecretStore();
}

/** Keys, deviceCode, cached till labels. Never an ops_ token. */
export function persistableIdentity(record: DeviceIdentityRecord): DeviceIdentityRecord {
  return {
    privateKeyPkcs8: record.privateKeyPkcs8,
    publicKeySpki: record.publicKeySpki,
    deviceCode: record.deviceCode,
    approved: record.approved,
    pairing: record.approved ? undefined : record.pairing,
    mode: record.mode,
    terminalName: record.terminalName,
  };
}

export async function loadDeviceIdentity(
  store?: SecretStore,
): Promise<DeviceIdentityRecord | null> {
  const resolved = store ?? (await defaultStore());
  const raw = await resolved.load();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DeviceIdentityRecord & { token?: string };
    if (!parsed.privateKeyPkcs8 || !parsed.publicKeySpki) return null;
    return persistableIdentity(parsed);
  } catch {
    return null;
  }
}

export async function saveDeviceIdentity(
  record: DeviceIdentityRecord,
  store?: SecretStore,
): Promise<void> {
  const resolved = store ?? (await defaultStore());
  await resolved.save(JSON.stringify(persistableIdentity(record)));
}

/**
 * Tauri reports whether the OS keychain holds the private key. Browser/dev
 * has no keychain command; callers must treat a missing status as unknown,
 * not as hardware-backed.
 */
export async function loadDeviceKeyStorageStatus(): Promise<DeviceKeyStorageStatus | null> {
  if (!tauriAvailable()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DeviceKeyStorageStatus>("device_key_storage_status");
}
