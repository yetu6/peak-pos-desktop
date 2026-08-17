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

export async function createStaffSession(args: {
  baseUrl: string;
  deviceCode: string;
  privateKeyPkcs8: string;
  staffNumber: string;
  pin: string;
}): Promise<OperationalSession> {
  const challenge = await issueChallenge(args.baseUrl, args.deviceCode);
  if (!challenge) throw new DeviceNotApprovedError();

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
