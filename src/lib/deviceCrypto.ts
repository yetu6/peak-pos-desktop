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
	const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToB64Url(bytes: Uint8Array): string { return bytesToB64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
export function rawPublicKeyB64Url(publicKeySpki: string): string { const der=b64ToBytes(publicKeySpki); if(der.length!==44||!ED25519_SPKI_PREFIX.every((v,i)=>der[i]===v)) throw new Error("Invalid Ed25519 public key"); return bytesToB64Url(der.slice(12)); }

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

async function importSigningKey(privateKeyPkcs8: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    b64ToBytes(privateKeyPkcs8) as BufferSource,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

/** Sign Peak's Base64 challenge nonce; return Base64 Ed25519 signature. */
export async function signChallengeNonce(
  privateKeyPkcs8: string,
  nonceB64: string,
): Promise<string> {
  const key = await importSigningKey(privateKeyPkcs8);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      key,
      b64ToBytes(nonceB64) as BufferSource,
    ),
  );
	return bytesToB64Url(signature);
}

/**
 * Sign a pairing-claim confirmation. Unlike [signChallengeNonce], the input is the
 * canonical UTF-8 claim message itself (colon-joined ids/name/mode), not a Base64 nonce —
 * it must byte-for-byte match `DevicePairingService.canonicalClaimMessage` on the server,
 * built from [canonicalClaimMessage] below.
 */
export async function signClaimMessage(
  privateKeyPkcs8: string,
  message: string,
): Promise<string> {
  const key = await importSigningKey(privateKeyPkcs8);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      key,
      new TextEncoder().encode(message) as BufferSource,
    ),
  );
  return bytesToB64(signature);
}

/**
 * Must match `DevicePairingService.canonicalClaimMessage` exactly: colon-joined
 * pairingRequestId, claimId, Base64 nonce, tenantId, propertyId, outletId (empty string
 * when absent), terminalName, mode.
 */
export function canonicalClaimMessage(args: {
  pairingRequestId: string;
  claimId: string;
  nonceB64: string;
  tenantId: string;
  propertyId: string;
  outletId?: string | null;
  terminalName: string;
  mode: string;
}): string {
  return [
    args.pairingRequestId,
    args.claimId,
    args.nonceB64,
    args.tenantId,
    args.propertyId,
    args.outletId ?? "",
    args.terminalName,
    args.mode,
  ].join(":");
}
