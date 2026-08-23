import { signChallengeNonce } from "./deviceCrypto";
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
  deviceCode: string;
  pairingCode: string;
  fingerprint: string;
  expiresAt: string;
}

export type PairingWaitStatus = "pending" | "approved" | "expired" | "denied";

export interface PairingStatus {
  status: PairingWaitStatus;
  deviceCode?: string;
  expiresAt?: string;
  terminalName?: string;
  mode?: string;
}

export interface DeviceChallenge {
  challengeId: string;
  nonce: string;
  expiresAt: string;
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
): Promise<PairingRequest> {
  const response = await fetch(`${baseUrl}/api/v1/devices/pairing-requests`, {
    method: "POST",
    headers: publicJsonHeaders(),
    body: JSON.stringify({ publicKey }),
  });
  if (!response.ok) {
    throw new Error(`Pairing request failed with HTTP ${response.status}`);
  }
  const body = (await readJson(response)) as PairingRequest;
  if (!body?.pairingRequestId || !body.deviceCode || !body.pairingCode) {
    throw new Error("Pairing request returned an incomplete response");
  }
  return body;
}

/** Truthful wait. Pending leaks no hotel. 404 is treated as expired. */
export async function getPairingStatus(
  baseUrl: string,
  pairingRequestId: string,
): Promise<PairingStatus> {
  const response = await fetch(
    `${baseUrl}/api/v1/devices/pairing-requests/${pairingRequestId}`,
  );
  if (response.status === 404) {
    return { status: "expired" };
  }
  if (!response.ok) {
    throw new Error(`Pairing status failed with HTTP ${response.status}`);
  }
  const body = (await readJson(response)) as Partial<PairingStatus>;
  if (
    body?.status !== "pending" &&
    body?.status !== "approved" &&
    body?.status !== "expired" &&
    body?.status !== "denied"
  ) {
    throw new Error("Pairing status returned an incomplete response");
  }
  if (body.status !== "approved") {
    return { status: body.status };
  }
  return {
    status: "approved",
    deviceCode: optionalId(body.deviceCode),
    expiresAt: optionalId(body.expiresAt),
    terminalName: optionalId(body.terminalName),
    mode: optionalId(body.mode),
  };
}

export async function issueChallenge(
  baseUrl: string,
  deviceCode: string,
): Promise<DeviceChallenge | null> {
  const response = await fetch(`${baseUrl}/api/v1/devices/challenges`, {
    method: "POST",
    headers: publicJsonHeaders(),
    body: JSON.stringify({ deviceCode }),
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

/**
 * "Who's using this terminal?" — a tap-to-select roster so a waiter never has to remember or
 * type a staff number. A convenience, not a hard requirement: any failure (device not yet
 * approved, revoked, offline, malformed response) resolves to an empty list rather than
 * throwing, so the till always falls back to manual staff-number entry instead of blocking the
 * lock screen. Real revocation is still caught the moment PIN entry is actually attempted.
 */
export async function fetchStaffRoster(
  baseUrl: string,
  deviceCode: string,
  privateKeyPkcs8: string,
): Promise<RosterEntry[]> {
  try {
    const challenge = await issueChallenge(baseUrl, deviceCode);
    if (!challenge) return [];
    const signature = await signChallengeNonce(privateKeyPkcs8, challenge.nonce);
    const response = await fetch(`${baseUrl}/api/v1/staff/sessions/roster`, {
      method: "POST",
      headers: publicJsonHeaders(),
      body: JSON.stringify({ deviceCode, challengeId: challenge.challengeId, signature }),
    });
    if (!response.ok) return [];
    const body = (await readJson(response)) as { staff?: unknown };
    if (!Array.isArray(body?.staff)) return [];
    return body.staff.filter(
      (entry): entry is RosterEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as RosterEntry).fullName === "string" &&
        typeof (entry as RosterEntry).staffNumber === "string",
    );
  } catch {
    return [];
  }
}

export async function createStaffSession(args: {
  baseUrl: string;
  deviceCode: string;
  privateKeyPkcs8: string;
  staffNumber: string;
  pin: string;
  /** True when this till already completed pairing. A 401 challenge is then revocation. */
  previouslyApproved?: boolean;
}): Promise<OperationalSession> {
  const challenge = await issueChallenge(args.baseUrl, args.deviceCode);
  if (!challenge) {
    if (args.previouslyApproved) throw new DeviceRevokedError();
    throw new DeviceNotApprovedError();
  }

  const signature = await signChallengeNonce(args.privateKeyPkcs8, challenge.nonce);
  const response = await fetch(`${args.baseUrl}/api/v1/staff/sessions`, {
    method: "POST",
    headers: publicJsonHeaders(),
    body: JSON.stringify({
      deviceCode: args.deviceCode,
      challengeId: challenge.challengeId,
      signature,
      staffNumber: args.staffNumber,
      pin: args.pin,
    }),
  });
  if (response.status === 401) throw new StaffLoginRejectedError();
  if (!response.ok) {
    throw new Error(`Staff session failed with HTTP ${response.status}`);
  }
  const body = (await readJson(response)) as Record<string, unknown>;
  if (typeof body?.token !== "string" || !body.token.startsWith("ops_")) {
    throw new StaffLoginRejectedError();
  }
  return {
    token: body.token,
    expiresAt: String(body.expiresAt ?? ""),
    deviceId: String(body.deviceId ?? ""),
    propertyId: String(body.propertyId ?? ""),
    sessionClass: optionalId(body.sessionClass),
    tenantId: optionalId(body.tenantId),
    userId: optionalId(body.userId),
    outletId: optionalId(body.outletId),
    mode: optionalId(body.mode),
    terminalName: optionalId(body.terminalName),
    staffNumber: args.staffNumber,
  };
}
