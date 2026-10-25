import { bytesToB64Url, signChallengeNonce } from "./deviceCrypto";
import type { OperationalSession } from "./operationalSession";
import type { TerminalBinding } from "./offlineAuthorization";
import { placeFrom, type TillPlace } from "./tillPlace";
import { yetuFetch } from "./yetuFetch";

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
 * The PIN typed is this person's setup code (409 POS_PIN_SETUP_REQUIRED, sent
 * only when the code is right): they choose their own PIN now, at this till.
 */
export class StaffPinSetupRequiredError extends Error {
  constructor(message = "Choose your own PIN.") {
    super(message);
    this.name = "StaffPinSetupRequiredError";
  }
}

/** The setup code is past its time (401 POS_SETUP_CODE_EXPIRED): a manager issues a new one. */
export class StaffSetupCodeExpiredError extends Error {
  constructor(message = "This setup code has expired.") {
    super(message);
    this.name = "StaffSetupCodeExpiredError";
  }
}

/** Words for a refused new PIN when Yetu's answer has none of its own. */
export const NEW_PIN_REFUSED_WORDS = "Choose a different six-digit PIN, one nobody could guess.";

/** Yetu refused the PIN the person chose (422); `words` is Yetu's own sentence saying why. */
export class StaffNewPinRefusedError extends Error {
  constructor(readonly words: string) {
    super("The new PIN was not accepted.");
    this.name = "StaffNewPinRefusedError";
  }
}

/** Named setting: the wait after a 429 that came with no time at all (Yetu's limiter always sends one). */
export const SIGN_IN_FALLBACK_WAIT_SECONDS = 60;

/**
 * Yetu limits sign-in attempts from one address (429 on /pos/sessions). The
 * till waits as long as Yetu asked (Retry-After, else Yetu's own sentence)
 * before the next attempt, and never treats it as being offline.
 */
export class StaffLoginRateLimitedError extends Error {
  constructor(
    readonly retryAfterSeconds: number,
    message = "Too many sign-in attempts. Wait before trying again.",
  ) {
    super(message);
    this.name = "StaffLoginRateLimitedError";
  }
}

/**
 * How long a 429 asked the till to wait. A web view reading a cross-origin
 * answer sees no Retry-After (Yetu does not expose it), so Yetu's own sentence
 * is read too.
 */
export async function retryAfterSecondsOf(response: Response): Promise<number> {
  const header = response.headers.get("Retry-After")?.trim() ?? "";
  if (/^\d+$/.test(header)) return Number(header);
  const body = (await readJson(response)) as { detail?: unknown } | null;
  const said = typeof body?.detail === "string" ? /in (\d+) seconds?/i.exec(body.detail) : null;
  return said ? Number(said[1]) : SIGN_IN_FALLBACK_WAIT_SECONDS;
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
  /** Encoded as QR: YETU-POS:1:<pairingCode>. Never contains claimToken. */
  qrPayload?: string;
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
  /** Authoritative workspace mode from the approved terminal row. */
  mode?: string;
  expiresAt?: string;
  offlineAuthority?: TerminalBinding;
}

export interface DeviceChallenge {
  challengeId: string;
  nonce: string;
  expiresAt: string;
	staff?: Array<{ id: string; displayName: string; staffSuffix: string; needsSetup?: boolean }>;
}

export interface RosterEntry {
  fullName: string;
  /** The local sequence to type on this terminal ("00042"), not the full staff number. */
  staffNumber: string;
  /** New here: signs in with the setup code a manager gave them, then chooses their own PIN at the till. */
  needsSetup?: boolean;
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

async function readProblem(response: Response): Promise<{ code?: string; detail?: string }> {
  const body = (await readJson(response)) as Record<string, unknown> | null;
  return {
    code: typeof body?.code === "string" ? body.code : undefined,
    detail: typeof body?.detail === "string" ? body.detail : undefined,
  };
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
  if (error instanceof StaffLoginRateLimitedError) {
    return error.message;
  }
  if (error instanceof StaffSetupCodeExpiredError) {
    return "This setup code has expired. Ask your manager for a new one.";
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

export function isDeviceNetworkFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch|network|Failed to fetch|ECONNREFUSED|NetworkError|HTTP 5\d\d/i.test(message);
}

export async function requestPairing(
  baseUrl: string,
  publicKey: string,
  deviceCredentialHash: string,
): Promise<PairingRequest> {
  const response = await yetuFetch(`${baseUrl}/api/v1/pos/pairing-requests`, {
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
  const response = await yetuFetch(
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
  const offlineAuthority = isTerminalBinding(body.offlineAuthority)
    ? body.offlineAuthority
    : undefined;
  return {
    status: body.status,
    terminalId,
    mode: optionalId(body.mode),
    expiresAt: optionalId(body.expiresAt),
    offlineAuthority,
  };
}

function isTerminalBinding(value: unknown): value is TerminalBinding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<TerminalBinding>;
  return (
    typeof binding.terminalId === "string" &&
    Number.isSafeInteger(binding.credentialEpoch) &&
    typeof binding.propertyId === "string" &&
    typeof binding.outletId === "string" &&
    typeof binding.registerId === "string" &&
    typeof binding.trustKeyId === "string" &&
    typeof binding.trustPublicKeyB64 === "string" &&
    typeof binding.configurationPayloadB64 === "string" &&
    Number.isSafeInteger(binding.revocationGeneration) &&
    Number.isSafeInteger(binding.pairedAtMs)
  );
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
	const response = await yetuFetch(`${baseUrl}/api/v1/pos/device/challenges`, {
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

/** Device presence for Hospitality Web connectivity (ONLINE/STALE/OFFLINE). */
export async function sendHeartbeat(
  baseUrl: string,
  terminalId: string,
  deviceCredential: string,
): Promise<void> {
  const response = await yetuFetch(
    `${baseUrl}/api/v1/pos/terminals/${encodeURIComponent(terminalId)}/heartbeat`,
    {
      method: "POST",
      headers: publicJsonHeaders(),
      body: JSON.stringify({ deviceCredential }),
    },
  );
  if (response.status === 401) {
    throw new DeviceRevokedError();
  }
  if (!response.ok && response.status !== 204) {
    throw new Error(`Heartbeat failed with HTTP ${response.status}`);
  }
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
  return (await fetchLockScreen(baseUrl, terminalId, deviceCredential)).staff;
}

/** The lock screen's staff list and the till's names (F-252), from one challenge. */
export async function fetchLockScreen(
  baseUrl: string,
	terminalId: string,
	deviceCredential = terminalId,
): Promise<{ staff: RosterEntry[]; place: TillPlace }> {
  try {
		const challenge = await issueChallenge(baseUrl, terminalId, deviceCredential);
    if (!challenge) return { staff: [], place: {} };
    return {
      staff: (challenge.staff ?? []).map((entry) => ({
        fullName: entry.displayName,
        staffNumber: entry.id,
        needsSetup: entry.needsSetup === true,
      })),
      place: placeFrom(challenge),
    };
  } catch {
    return { staff: [], place: {} };
  }
}

export async function createStaffSession(args: {
  baseUrl: string;
  deviceCode?: string;
	terminalId?: string;
	deviceCredential?: string;
  privateKeyPkcs8?: string;
  signChallenge?: (nonce: string) => Promise<string>;
  staffNumber: string;
  /** The person's PIN, or the setup code a manager gave them. */
  pin: string;
  /** With a setup code as `pin`: the PIN the person chose, which they sign in with from now on. */
  newPin?: string;
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

  let signature: string;
  if (args.signChallenge) {
    signature = await args.signChallenge(challenge.nonce);
  } else if (args.privateKeyPkcs8) {
    signature = await signChallengeNonce(args.privateKeyPkcs8, challenge.nonce);
  } else {
    throw new Error("Device signing authority is unavailable");
  }
	const response = await yetuFetch(`${args.baseUrl}/api/v1/pos/sessions`, {
    method: "POST",
    headers: publicJsonHeaders(),
    body: JSON.stringify({
			challengeId: challenge.challengeId,
			signature,
			staffId: args.staffNumber,
      pin: args.pin,
      newPin: args.newPin,
    }),
  });
  if (response.status === 401) {
    const problem = await readProblem(response);
    if (problem.code === "POS_SETUP_CODE_EXPIRED") throw new StaffSetupCodeExpiredError();
    throw new StaffLoginRejectedError();
  }
  if (response.status === 429) throw new StaffLoginRateLimitedError(await retryAfterSecondsOf(response));
  if (response.status === 409 && !args.newPin) {
    if ((await readProblem(response)).code === "POS_PIN_SETUP_REQUIRED") throw new StaffPinSetupRequiredError();
  } else if (response.status === 422 && args.newPin) {
    const { detail } = await readProblem(response);
    throw new StaffNewPinRefusedError(detail?.trim() || NEW_PIN_REFUSED_WORDS);
  }
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
    propertyName: placeFrom(body).propertyName,
    outletName: placeFrom(body).outletName,
    prepStations: stringArray(body.prepStations),
		capabilities: stringArray(body.capabilities),
		permissions: stringArray(body.permissions),
  };
}

/** Defensive against an older, un-patched backend that has not deployed
 *  R6A-C yet: missing/malformed capabilities or permissions degrade to an
 *  empty list (fail closed on visibility) rather than throwing. */
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
