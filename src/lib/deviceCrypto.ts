const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

export interface DeviceKeyPair {
  publicKeySpki: string;
  privateKeyPkcs8: string;
}

export function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function b64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Peak's DeviceSessionService parses the public key as Base64 of Java's
 * X.509 SubjectPublicKeyInfo encoding for Ed25519 (`KeyPairGenerator
 * getInstance("Ed25519")`). WebCrypto `exportKey("spki")` is that encoding.
 */
export async function generateDeviceKeyPair(): Promise<DeviceKeyPair> {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  );
  return {
    publicKeySpki: bytesToB64(spki),
    privateKeyPkcs8: bytesToB64(pkcs8),
  };
}

export function isX509SpkiEd25519(publicKeySpki: string): boolean {
  try {
    const der = b64ToBytes(publicKeySpki);
    if (der.byteLength !== 44) return false;
    return ED25519_SPKI_PREFIX.every((byte, index) => der[index] === byte);
  } catch {
    return false;
  }
}

/** Sign Peak's Base64 challenge nonce; return Base64 Ed25519 signature. */
export async function signChallengeNonce(
  privateKeyPkcs8: string,
  nonceB64: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    b64ToBytes(privateKeyPkcs8) as BufferSource,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      key,
      b64ToBytes(nonceB64) as BufferSource,
    ),
  );
  return bytesToB64(signature);
}
