import { afterEach, describe, expect, it } from "vitest";
import { generateDeviceKeyPair } from "./deviceCrypto";
import { loadDeviceIdentity, loadDeviceKeyStorageStatus, saveDeviceIdentity, type SecretStore } from "./deviceIdentity";

function memoryStore(initial?: string): SecretStore {
  let value = initial ?? null;
  return {
    async load() {
      return value;
    },
    async save(next: string) {
      value = next;
    },
  };
}

describe("deviceIdentity", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("persists the private key and later the deviceCode", async () => {
    const keys = await generateDeviceKeyPair();
    const store = memoryStore();
    await saveDeviceIdentity(
      {
        privateKeyPkcs8: keys.privateKeyPkcs8,
        publicKeySpki: keys.publicKeySpki,
      },
      store,
    );

    await saveDeviceIdentity(
      {
        privateKeyPkcs8: keys.privateKeyPkcs8,
        publicKeySpki: keys.publicKeySpki,
        deviceCode: "dev_abc",
        pairing: {
          pairingRequestId: "6f1a9c2e-6b1d-4a51-9f0e-2c7a5d3b8e14",
          pairingCode: "418205",
          claimToken: "claim-token-with-at-least-thirty-two-characters",
          fingerprint: "AA:BB",
          expiresAt: "2026-08-15T21:00:00Z",
        },
      },
      store,
    );

    const loaded = await loadDeviceIdentity(store);
    expect(loaded?.deviceCode).toBe("dev_abc");
    expect(loaded?.pairing?.pairingCode).toBe("418205");
    expect(loaded?.privateKeyPkcs8).toBe(keys.privateKeyPkcs8);
    expect(loaded?.publicKeySpki).toBe(keys.publicKeySpki);
  });

  it("keeps the same keypair when the store is opened again at the same path", async () => {
    const keys = await generateDeviceKeyPair();
    const store = memoryStore();
    await saveDeviceIdentity(
      {
        ...keys,
        deviceCode: "dev_abc",
        approved: true,
        terminalName: "Bar 1",
        mode: "POS",
      },
      store,
    );
    const afterUpgrade = await loadDeviceIdentity(store);
    expect(afterUpgrade).toMatchObject({
      privateKeyPkcs8: keys.privateKeyPkcs8,
      publicKeySpki: keys.publicKeySpki,
      deviceCode: "dev_abc",
      approved: true,
      terminalName: "Bar 1",
      mode: "POS",
    });
  });

  it("falls back to localStorage when no OS store is injected", async () => {
    const keys = await generateDeviceKeyPair();
    await saveDeviceIdentity({
      privateKeyPkcs8: keys.privateKeyPkcs8,
      publicKeySpki: keys.publicKeySpki,
      deviceCode: "dev_web",
    });
    const loaded = await loadDeviceIdentity();
    expect(loaded?.deviceCode).toBe("dev_web");
  });

  it("never writes an ops_ token into the identity store", async () => {
    const keys = await generateDeviceKeyPair();
    let saved = "";
    await saveDeviceIdentity(
      {
        ...keys,
        deviceCode: "dev_abc",
        approved: true,
        token: "ops_secret",
      } as never,
      {
        async load() {
          return saved || null;
        },
        async save(next: string) {
          saved = next;
        },
      },
    );
    expect(saved).not.toContain("ops_");
    expect(JSON.parse(saved).token).toBeUndefined();
  });

  it("does not claim hardware-backed storage in the browser", async () => {
    await expect(loadDeviceKeyStorageStatus()).resolves.toBeNull();
  });
});
