import { bytesToB64Url, signChallengeNonce } from "./deviceCrypto";
import type { OperationalSession } from "./operationalSession";

export class DeviceNotApprovedError extends Error {
  constructor(message = "This register has not been approved yet") {
    super(message);
    this.name = "DeviceNotApprovedError";
  }
}

export class StaffLoginRejectedError extends Error {
  constructor(message = "Device or credentials were not accepted") {
    super(message);
    this.name = "StaffLoginRejectedError";
  }
}

/**
 * Peak refused a challenge for a till that was already paired. HTTP is 401
 * for unpaired and revoked alike; the till knows it used to be trusted.
 */
export class DeviceRevokedError extends Error {
  constructor(message = "This register is no longer trusted. Pair it again.") {
    super(message);
    this.name = "DeviceRevokedError";
  }
}

export interface PairingRequest {
  pairingRequestId: string;
  pairingCode: string;
  claimToken: string;
  fingerprint: string;
  expiresAt: string;
}

export type PairingWaitStatus =
  | "PENDING"
  | "CONSUMED"
  | "REJECTED"
  | "EXPIRED";

export interface PairingStatus {
  status: PairingWaitStatus;
  terminalId?: string;
  expiresAt?: string;
}

export interface DeviceChallenge {
  challengeId: string;
  nonce: string;
  expiresAt: string;
	staff?: Array<{ id: string; displayName: string; staffSuffix: string }>;
}

export interface RosterEntry {
  fullName: string;
  /** The local sequence to type on this terminal ("00042"), not the full staff number. */
  staffNumber: string;
}

function publicJsonHeaders(): HeadersInit {
  return { "Content-Type": "application/json" };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Human copy for the till. Never a stack trace. */
export function humanDeviceError(error: unknown): string {
  if (error instanceof DeviceNotApprovedError) {
    return "Not approved yet. Ask a manager to enter this pairing code.";
  }
  if (error instanceof DeviceRevokedError) {
    return "This register is no longer trusted. Pair it again.";
  }
  if (error instanceof StaffLoginRejectedError) {
    return "That staff number or PIN was not accepted.";
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (/fetch|network|Failed to fetch|ECONNREFUSED|NetworkError/i.test(msg)) {
    return "Can't reach Peak. Check the server address.";
  }
  if (/HTTP 404/.test(msg)) {
    return "Can't reach Peak. Check the server address.";
  }
  if (/HTTP 5\d\d/.test(msg)) {
    return "Peak is not responding. Try again in a moment.";
  }
  if (/denied/i.test(msg)) {
    return "This pairing was denied. Generate a new code.";
  }
  if (/expired/i.test(msg)) {
    return "This code expired. Generate a new one.";
  }
  if (/revok/i.test(msg)) {
    return "This register is no longer trusted. Pair it again.";
  }
  return "Something went wrong. Try again.";
}

export async function requestPairing(
  baseUrl: string,
  publicKey: string,
  deviceCredentialHash: string,
): Promise<PairingRequest> {
  const response = await fetch(`${baseUrl}/api/v1/pos/pairing-requests`, {
    method: "POST",
    headers: publicJsonHeaders(),
    body: JSON.stringify({ publicKey, deviceCredentialHash }),
  });
  if (!response.ok) {
    throw new Error(`Pairing request failed with HTTP ${response.status}`);
  }
  const body = (await readJson(response)) as PairingRequest;
  if (
    !body?.pairingRequestId ||
    !body.pairingCode ||
    !body.claimToken ||
    !body.fingerprint ||
    !body.expiresAt ||
    !Number.isFinite(Date.parse(body.expiresAt))
  ) {
    throw new Error("Pairing request returned an incomplete response");
  }
  return body;
}

const PAIRING_WAIT_STATUSES: readonly PairingWaitStatus[] = [
  "PENDING",
  "CONSUMED",
  "REJECTED",
  "EXPIRED",
];

/** Polling requires the terminal-only claim token; request UUID alone reveals nothing. */
export async function getPairingStatus(
  baseUrl: string,
  pairingRequestId: string,
  claimToken: string,
): Promise<PairingStatus> {
  const response = await fetch(
    `${baseUrl}/api/v1/pos/pairing-requests/${pairingRequestId}`,
    { headers: { "X-Peak-Pairing-Token": claimToken } },
  );
  if (!response.ok) {
    throw new Error(`Pairing status failed with HTTP ${response.status}`);
  }
  const body = (await readJson(response)) as Partial<PairingStatus>;
  if (!body?.status || !PAIRING_WAIT_STATUSES.includes(body.status)) {
    throw new Error("Pairing status returned an incomplete response");
  }
  const terminalId = optionalId(body.terminalId);
  if (body.status === "CONSUMED" && !terminalId) {
    throw new Error("Pairing status returned an incomplete response");
  }
  return { status: body.status, terminalId, expiresAt: optionalId(body.expiresAt) };
}

export function generateDeviceCredential(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToB64Url(bytes);
}

export async function deviceCredentialDigest(credential: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function issueChallenge(
  baseUrl: string,
	terminalId: string,
	deviceCredential = terminalId,
): Promise<DeviceChallenge | null> {
	const response = await fetch(`${baseUrl}/api/v1/pos/device/challenges`, {
    method: "POST",
    headers: publicJsonHeaders(),
		body: JSON.stringify({ terminalId, deviceCredential }),
  });
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`Challenge failed with HTTP ${response.status}`);
  }
  const body = (await readJson(response)) as DeviceChallenge;
  if (!body?.challengeId || !body.nonce) {
    throw new Error("Challenge returned an incomplete response");
  }
  return body;
}

function optionalId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredId(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * "Who's using this terminal?" — a tap-to-select roster so a waiter never has to remember or
 * type a staff number. A convenience, not a hard requirement: any failure (device not yet
 * approved, revoked, offline, malformed response) resolves to an empty list rather than
 * throwing, so the till always falls back to manual staff-number entry instead of blocking the
 * lock screen. Real revocation is still caught the moment PIN entry is actually attempted.
 */
export async function fetchStaffRoster(
  baseUrl: string,
	terminalId: string,
	deviceCredential = terminalId,
): Promise<RosterEntry[]> {
  try {
		const challenge = await issueChallenge(baseUrl, terminalId, deviceCredential);
    if (!challenge) return [];
		return (challenge.staff ?? []).map((entry) => ({ fullName: entry.displayName, staffNumber: entry.id }));
  } catch {
    return [];
  }
}

export async function createStaffSession(args: {
  baseUrl: string;
  deviceCode?: string;
	terminalId?: string;
	deviceCredential?: string;
  privateKeyPkcs8: string;
  staffNumber: string;
  pin: string;
  /** True when this till already completed pairing. A 401 challenge is then revocation. */
  previouslyApproved?: boolean;
}): Promise<OperationalSession> {
	const terminalId = args.terminalId ?? "";
	const credential = args.deviceCredential ?? args.deviceCode;
	const challenge = await issueChallenge(args.baseUrl, terminalId, credential);
  if (!challenge) {
    if (args.previouslyApproved) throw new DeviceRevokedError();
    throw new DeviceNotApprovedError();
  }

  const signature = await signChallengeNonce(args.privateKeyPkcs8, challenge.nonce);
	const response = await fetch(`${args.baseUrl}/api/v1/pos/sessions`, {
    method: "POST",
    headers: publicJsonHeaders(),
    body: JSON.stringify({
			challengeId: challenge.challengeId,
			signature,
			staffId: args.staffNumber,
      pin: args.pin,
    }),
  });
  if (response.status === 401) throw new StaffLoginRejectedError();
  if (!response.ok) {
    throw new Error(`Staff session failed with HTTP ${response.status}`);
  }
  const body = (await readJson(response)) as Record<string, unknown>;
	const expiresAt = requiredId(body.expiresAt);
	const tenantId = requiredId(body.tenantId);
	const propertyId = requiredId(body.propertyId);
	const outletId = requiredId(body.outletId);
	const terminalIdFromServer = requiredId(body.terminalId);
	const staffId = requiredId(body.staffId);
	if (
		typeof body?.token !== "string" || body.token.length < 32 ||
		!expiresAt || !Number.isFinite(Date.parse(expiresAt)) ||
		!tenantId || !propertyId || !outletId || !terminalIdFromServer || !staffId ||
		body.assurance !== "RESTRICTED"
	) {
		throw new StaffLoginRejectedError("Peak returned an incomplete POS session");
  }
  return {
    token: body.token,
		expiresAt,
		tenantId,
		propertyId,
		outletId,
		terminalId: terminalIdFromServer,
		staffId,
		assurance: "RESTRICTED",
    mode: optionalId(body.mode),
    terminalName: optionalId(body.terminalName),
  };
}
