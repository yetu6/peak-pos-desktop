import { describe, expect, it } from "vitest";
import {
  generateDeviceKeyPair,
  isX509SpkiEd25519,
  signChallengeNonce,
} from "./deviceCrypto";

/** Peak stores Base64(X.509 SPKI Ed25519). DER prefix is 12 bytes + 32-byte key. */
const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

describe("deviceCrypto", () => {
  it("emits a Base64 X.509 SPKI Ed25519 public key Peak can parse", async () => {
    const keys = await generateDeviceKeyPair();
    expect(isX509SpkiEd25519(keys.publicKeySpki)).toBe(true);

    const der = b64ToBytes(keys.publicKeySpki);
    expect(der.byteLength).toBe(44);
    expect(Array.from(der.slice(0, 12))).toEqual(Array.from(ED25519_SPKI_PREFIX));
    expect(keys.publicKeySpki.startsWith("MCowBQYDK2VwAyEA")).toBe(true);
  });

  it("signs a Base64 challenge nonce the way DeviceSessionService verifies", async () => {
    const keys = await generateDeviceKeyPair();
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const nonceB64 = btoa(String.fromCharCode(...nonce));

    const signatureB64 = await signChallengeNonce(keys.privateKeyPkcs8, nonceB64);
    const signature = b64ToBytes(signatureB64);
    expect(signature.byteLength).toBe(64);

    const publicKey = await crypto.subtle.importKey(
      "spki",
      b64ToBytes(keys.publicKeySpki) as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      signature as BufferSource,
      nonce,
    );
    expect(ok).toBe(true);
  });
});
