export interface NativeDeviceIdentity {
  publicKey: string;
}

export interface DeviceAuthority {
  ensureIdentity(): Promise<NativeDeviceIdentity>;
  signChallenge(nonce: string): Promise<string>;
}

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export function createNativeDeviceAuthority(invoke: Invoke): DeviceAuthority {
  return {
    ensureIdentity: () =>
      invoke("ensure_device_identity") as Promise<NativeDeviceIdentity>,
    signChallenge: (nonce) =>
      invoke("sign_device_challenge", { nonce }) as Promise<string>,
  };
}

export async function loadNativeDeviceAuthority(): Promise<DeviceAuthority> {
  const { invoke } = await import("@tauri-apps/api/core");
  return createNativeDeviceAuthority(invoke);
}
